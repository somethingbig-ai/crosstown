// look.js: the LOOK of the subway stations. Materials, procedural canvas textures, signs, name tablets, route badges, posters.
// Everything is made in code (canvas 2D); no outside assets. See CONTRACT.md for light and units.
//
//   const look = makeLook(THREE, opts)     opts: { anisotropy = 8, macro = true, darkTile = [r,g,b] 0..255, seed = 1 }
//   look.mat.<name>                        tiling materials, built on FIRST USE (lazy) and cached. UVs IN METRES. vertexColors on, fog off.
//   look.tablet / band / sign / badge / entranceSign / exitSign / poster          see each function below
//   look.drawBadge(ctx, route, x, y, size)  (also a plain export)
//   look.stats()                           { textures, bytes } GPU memory made so far (RGBA8 + mip chain)
//   look.dispose()
//
// UV conventions the geometry builder needs to know (all in metres):
//   tile, tileDark  u along the wall, v UP with v = 0 AT THE FLOOR (the big-scale grime map puts dirt in the lowest half metre).
//   edge            u along the platform edge, v 0..0.6 across, v = 0 is the TRACK side.
//   stair           u along the step's width. TREADS: v = 0 at the front (nosing) edge, running back (0..about 0.3).
//                   RISERS: use v from 0.45 upward (0.45..0.65), so they get plain concrete and no nosing. Period 1.2 m both ways.
//   trackbed        u ALONG the track, v across it, period 3.0 m in v with the TRACK CENTRE AT v = 1.5 (rails sit at v = 1.5 +- 0.7175).
//   steel           period 0.6 m (u) x 1.2 m (v). Rivet rows run up at u = 0.04 and 0.26 (mod 0.3): a 0.3 m wide face with u 0..0.3
//                   gets a rivet row near each edge.
//   rail            u along the rail, v period 0.28 m: v 0..0.07 is the bright worn HEAD (top face), v 0.10..0.28 is dark rusty side.
//   concrete        v up (board-form lines run level). floor / platform / ceiling: any way round.
// Big-scale variation: tile, tileDark, floor, platform, edge, ceiling and concrete also multiply in a small low-res "macro" map with a long
// period (11 to 20 m) through onBeforeCompile, so the repeat of the detail texture does not show. NOTE: material.clone() does not copy
// onBeforeCompile in three r170; share the materials instead of cloning them (or pass opts.macro = false).

export const ROUTES = (() => {
  const R = {}; const add = (ids, color, trunk, text = '#ffffff') => { for (const id of ids) R[id] = { color, text, trunk }; };
  add(['1', '2', '3'], '#EE352E', '7 Av');
  add(['4', '5', '6'], '#00933C', 'Lexington Av');
  add(['7'], '#B933AD', 'Flushing');
  add(['A', 'C', 'E'], '#0039A6', '8 Av');
  add(['B', 'D', 'F', 'M'], '#FF6319', '6 Av');
  add(['N', 'Q', 'R', 'W'], '#FCCC0A', 'Broadway', '#15130f');
  add(['S'], '#808183', '42 St Shuttle');
  add(['L'], '#A7A9AC', 'Canarsie');
  return R;
})();

const SANS = '"Avenir Next", Avenir, "Segoe UI", Lato, "DejaVu Sans", Arial, sans-serif';
const SERIF = 'Georgia, "Bitstream Charter", C059, "Times New Roman", serif';

// ---------------------------------------------------------------- small maths
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// Periodic value-noise fbm as a Float32Array (0..1, mean about 0.5). cx, cy = lattice cells across the picture at the first octave.
function fbmField(w, h, cx, cy, oct, seed, gain = 0.5) {
  const out = new Float32Array(w * h), r = rng(seed); let amp = 1, tot = 0;
  for (let o = 0; o < oct && cx <= w / 2 && cy <= h / 2; o++, cx *= 2, cy *= 2, amp *= gain) {
    const g = new Float32Array(cx * cy); for (let i = 0; i < g.length; i++) g[i] = r();
    const x0 = new Int32Array(w), x1 = new Int32Array(w), wx = new Float32Array(w);
    for (let x = 0; x < w; x++) { const f = x * cx / w, i = Math.floor(f), t = f - i; x0[x] = i % cx; x1[x] = (i + 1) % cx; wx[x] = t * t * (3 - 2 * t); }
    for (let y = 0; y < h; y++) {
      const f = y * cy / h, i = Math.floor(f), t = f - i, wy = t * t * (3 - 2 * t), r0 = (i % cy) * cx, r1 = ((i + 1) % cy) * cx; let p = y * w;
      for (let x = 0; x < w; x++, p++) { const a = g[r0 + x0[x]], b = g[r0 + x1[x]], c = g[r1 + x0[x]], d = g[r1 + x1[x]], top = a + (b - a) * wx[x], bot = c + (d - c) * wx[x]; out[p] += amp * (top + (bot - top) * wy); }
    }
    tot += amp;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// per-pixel painter: fn(d, W, H) fills an RGBA Uint8ClampedArray (alpha preset to 255)
function pixels(W, H, fn) { const c = mkCanvas(W, H), ctx = c.getContext('2d'), id = ctx.createImageData(W, H), d = id.data; for (let i = 3; i < d.length; i += 4) d[i] = 255; fn(d, W, H); ctx.putImageData(id, 0, 0); return { c, ctx }; }
// draw something 9 times so that it wraps round the edges (fn must draw the same thing each call)
function wrap9(ctx, W, H, fn) { for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) { ctx.save(); ctx.translate(ox * W, oy * H); fn(); ctx.restore(); } }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function hexRgb(c) { if (Array.isArray(c)) return c; const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c)); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [128, 128, 128]; }
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ---------------------------------------------------------------- route badge (our own: a rounded square, a clean bold letter)
export function drawBadge(ctx, route, x, y, size) {
  const R = ROUTES[route] || { color: '#55585c', text: '#ffffff' };
  ctx.save();
  rrect(ctx, x, y, size, size, size * 0.2); ctx.fillStyle = R.color; ctx.fill();
  ctx.fillStyle = R.text; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const s = String(route); let fs = size * (s.length > 1 ? 0.5 : 0.7); ctx.font = `700 ${fs}px ${SANS}`;
  const m = ctx.measureText(s), asc = m.actualBoundingBoxAscent || fs * 0.72, desc = m.actualBoundingBoxDescent || 0;
  ctx.fillText(s, x + size / 2, y + size / 2 + (asc - desc) / 2);
  ctx.restore();
}
const ARROW = { right: 0, downright: 45, down: 90, downleft: 135, left: 180, upleft: 225, up: 270, upright: 315 };
function drawArrow(ctx, cx, cy, size, dir, color) {
  if (!(dir in ARROW)) return;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ARROW[dir] * Math.PI / 180); const s = size / 2;
  ctx.strokeStyle = color; ctx.lineWidth = size * 0.15; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-s * 0.78, 0); ctx.lineTo(s * 0.74, 0); ctx.moveTo(s * 0.12, -s * 0.62); ctx.lineTo(s * 0.76, 0); ctx.lineTo(s * 0.12, s * 0.62); ctx.stroke();
  ctx.restore();
}

// ================================================================= makeLook
export function makeLook(THREE, opts = {}) {
  const ANISO = opts.anisotropy ?? 8, MACRO = opts.macro !== false, SEED = opts.seed ?? 1;
  const textures = [], materials = []; let bytes = 0;
  const cache = new Map();

  function texOf(canvas, mu, mv, o = {}) {       // mu, mv = metres covered by the picture (omit for a 0..1 picture)
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = o.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (mu) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / mu, 1 / mv); } else { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = ANISO; t.needsUpdate = true;
    t.userData.metres = [mu || 0, mv || 0];
    textures.push(t); bytes += canvas.width * canvas.height * 4 * 4 / 3;
    return t;
  }
  function litMat(map, macro) {                  // unlit, takes the builder's vertex colours
    const m = new THREE.MeshBasicMaterial({ map, vertexColors: true, fog: false });
    if (macro && MACRO) {
      const [mu, mv] = map.userData.metres, [Mu, Mv] = macro.userData.metres, sc = new THREE.Vector2(mu / Mu, mv / Mv);
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uMacro = { value: macro }; sh.uniforms.uMacroScale = { value: sc };
        sh.fragmentShader = sh.fragmentShader
          .replace('void main() {', 'uniform sampler2D uMacro;\nuniform vec2 uMacroScale;\nvoid main() {')
          .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= texture2D( uMacro, vMapUv * uMacroScale ).rgb * 2.0;');
      };
      m.customProgramCacheKey = () => 'sublook-macro';
    }
    materials.push(m); return m;
  }
  function selfMat(map, gain = 1) {              // unlit and self-lit (signs)
    const m = new THREE.MeshBasicMaterial({ map, fog: false, toneMapped: false }); if (gain !== 1) m.color.setRGB(gain, gain, gain);
    materials.push(m); return m;
  }
  function glow(r, g, b) { const m = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false }); m.color.setRGB(r, g, b); materials.push(m); return m; }

  // ------------------------------------------------------------- macro maps (multiplier / 2, linear data)
  // wall: 19.5 x 4.88 m. Dirt in the lowest half metre, long leak streaks, soft blotches.
  function macroWall() {
    const W = 512, H = 128, n1 = fbmField(W, H, 8, 2, 5, SEED + 901), n2 = fbmField(W, H, 32, 8, 3, SEED + 902), st = new Float32Array(W * H), r = rng(SEED + 903);
    for (let i = 0; i < 26; i++) {               // leak streaks, running down
      let x = r() * W; const y0 = Math.floor(r() * H * 0.75), len = 14 + r() * 60, wd = 0.7 + r() * 1.8, a = 0.12 + r() * 0.3;
      for (let k = 0; k < len; k++) { const y = y0 + k; if (y >= H) break; x += (r() - 0.5) * 0.5; const f = a * Math.pow(1 - k / len, 0.8) * Math.min(1, k / 3);
        for (let dx = -5; dx <= 5; dx++) { const xi = ((Math.round(x) + dx) % W + W) % W; st[y * W + xi] += f * Math.exp(-(dx * dx) / (wd * wd)); } }
    }
    const { c } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const v = (1 - (y + 0.5) / H) * 4.88;
        for (let x = 0; x < W; x++, p++) {
          let m = 1 + (n1[p] - 0.5) * 0.2, tint = 0;
          const hgt = 0.22 + n2[p] * 0.5, low = 1 - sstep(0.02, hgt, v); tint += low * (0.25 + n1[p] * 0.3);
          tint += Math.min(0.5, st[p]);
          const blot = sstep(0.6, 0.72, n1[p]) * 0.1; tint += blot;
          const R = m * (1 - tint * 0.62), G = m * (1 - tint * 0.72), B = m * (1 - tint * 0.9);
          d[p * 4] = R * 127.5; d[p * 4 + 1] = G * 127.5; d[p * 4 + 2] = B * 127.5;
        } }
    });
    return texOf(c, 19.5, 4.88, { data: true });
  }
  // floor: 13 m. Lighter wear paths, dark damp patches, blotches.
  function macroFloor() {
    const W = 256, H = 256, n1 = fbmField(W, H, 4, 4, 5, SEED + 911), n2 = fbmField(W, H, 6, 6, 4, SEED + 912), n3 = fbmField(W, H, 3, 12, 3, SEED + 913);
    const { c } = pixels(W, H, (d) => {
      for (let p = 0; p < W * H; p++) {
        let m = 1 + (n1[p] - 0.5) * 0.36 + (n3[p] - 0.5) * 0.2;
        const damp = sstep(0.6, 0.68, n2[p]); m *= 1 - damp * 0.3;
        d[p * 4] = m * 127.5 * (1 - damp * 0.02); d[p * 4 + 1] = m * 127.5; d[p * 4 + 2] = m * 127.5 * (1 + damp * 0.03);
      }
    });
    return texOf(c, 13, 13, { data: true });
  }
  // ceiling and raw concrete: 11 m. Soot clouds and brown water marks.
  function macroCeil() {
    const W = 256, H = 256, n1 = fbmField(W, H, 4, 4, 5, SEED + 921), n2 = fbmField(W, H, 7, 7, 4, SEED + 922);
    const { c } = pixels(W, H, (d) => {
      for (let p = 0; p < W * H; p++) {
        let m = 1 + (n1[p] - 0.5) * 0.4; const soot = sstep(0.55, 0.75, n2[p]); m *= 1 - soot * 0.32; const wet = sstep(0.62, 0.7, n1[p]) * 0.22;
        d[p * 4] = m * 127.5 * (1 - wet * 0.5); d[p * 4 + 1] = m * 127.5 * (1 - wet * 0.72); d[p * 4 + 2] = m * 127.5 * (1 - wet);
      }
    });
    return texOf(c, 11, 11, { data: true });
  }
  const macro = (k) => { if (!MACRO) return null; if (!cache.has('macro' + k)) cache.set('macro' + k, k === 'wall' ? macroWall() : k === 'floor' ? macroFloor() : macroCeil()); return cache.get('macro' + k); };

  // ------------------------------------------------------------- glazed wall tile (3 x 6 inch, running bond)
  function texTile(dark) {
    const W = dark ? 1024 : 2048, H = dark ? 512 : 1024, tw = 64, th = 32, cols = W / tw, rows = H / th, S = SEED * 131 + (dark ? 77 : 11), r = rng(S);
    const cloud = fbmField(W, H, W / 128, H / 128, 5, S + 1), grime = fbmField(W, H, W / 256, H / 256, 5, S + 2), fine = fbmField(W, H, W / 8, H / 8, 2, S + 3);
    const base = dark ? (opts.darkTile || [30, 52, 43]) : [226, 224, 214], grout = dark ? [70, 66, 58] : [128, 121, 108];
    const n = cols * rows, shade = new Float32Array(n), tr = new Float32Array(n), tb = new Float32Array(n), gx = new Float32Array(n), gy = new Float32Array(n),
      iL = new Float32Array(n), iR = new Float32Array(n), iT = new Float32Array(n), iB = new Float32Array(n), kind = new Uint8Array(n), sx = new Float32Array(n), sy = new Float32Array(n), sa = new Float32Array(n),
      k1 = new Float32Array(n), k2 = new Float32Array(n), k3 = new Float32Array(n);
    for (let t = 0; t < n; t++) {
      shade[t] = (r() - 0.5) * 0.05 + (r() < 0.07 ? (r() - 0.6) * 0.07 : 0); tr[t] = 1 + (r() - 0.5) * 0.016; tb[t] = 1 + (r() - 0.55) * 0.035;
      const ga = r() * 6.283, gm = r() * r() * (dark ? 0.22 : 0.08); gx[t] = Math.cos(ga) * gm; gy[t] = Math.sin(ga) * gm;
      iL[t] = 0.5 + r() * 0.8; iR[t] = 0.5 + r() * 0.8; iT[t] = 0.5 + r() * 0.8; iB[t] = 0.5 + r() * 0.8;
      sx[t] = r() * tw; sy[t] = r() * th; sa[t] = r() * r() * (dark ? 0.11 : 0.05);
      const q = r(); kind[t] = q < 0.018 ? 1 /* replaced: newer, cooler */ : q < 0.05 ? 2 /* aged, yellowed */ : q < 0.07 ? 3 /* chipped corner */ : q < 0.085 ? 4 /* cracked */ : 0;
      k1[t] = r(); k2[t] = r(); k3[t] = r();
    }
    // drip stains under joints
    const drip = new Float32Array(W * H), nd = Math.round(60 * W * H / (2048 * 1024));
    for (let i = 0; i < nd; i++) {
      let x = Math.floor(r() * cols * 2) * (tw / 2) + (r() - 0.5) * 6; const y0 = Math.floor(r() * rows) * th, len = 40 + r() * r() * 520, wd = 1.5 + r() * 5, a = 0.08 + r() * 0.3;
      for (let k = 0; k < len; k++) { const y = (y0 + k) % H; x += (r() - 0.5) * 0.35; const f = a * Math.pow(1 - k / len, 1.3) * Math.min(1, k / 5), xr = Math.round(x), sp = Math.ceil(wd * 2.2);
        for (let dx = -sp; dx <= sp; dx++) { const xi = ((xr + dx) % W + W) % W; drip[y * W + xi] += f * Math.exp(-(dx * dx) / (wd * wd)); } }
    }
    const { c } = pixels(W, H, (d) => {
      const wn = rng(S + 9);
      for (let y = 0, p = 0; y < H; y++) {
        const row = (y / th) | 0, py = y - row * th + 0.5, off = (row & 1) ? tw / 2 : 0;
        for (let x = 0; x < W; x++, p++) {
          let xo = x + off; if (xo >= W) xo -= W; const col = (xo / tw) | 0, px = xo - col * tw + 0.5, t = row * cols + col, kd = kind[t];
          const dl = px - iL[t], dr = tw - iR[t] - px, dt = py - iT[t], db = th - iB[t] - py, dd = Math.min(dl, dr, dt, db), cov = clamp01(dd + 0.5), gr = grime[p];
          // tile face
          let v = 1 + shade[t] + (cloud[p] - 0.5) * 0.09 - sstep(0.52, 0.8, gr) * 0.07 + (px / tw - 0.5) * gx[t] + (py / th - 0.5) * gy[t] + (fine[p] - 0.5) * 0.025;
          if (dt < 2.2) v += (dark ? 0.12 : 0.035) * (1 - dt / 2.2); if (db < 2.4) v -= 0.07 * (1 - db / 2.4);      // glaze rolls over the edge: lit above, shaded below
          if (dl < 1.8) v += 0.02 * (1 - dl / 1.8); if (dr < 1.8) v -= 0.03 * (1 - dr / 1.8);
          const ex = (px - sx[t]) / 26, ey = (py - sy[t]) / 12, spec = sa[t] * Math.exp(-(ex * ex + ey * ey));       // each tile sits a little off plane and throws its own soft glint
          let R = base[0] * v * tr[t], G = base[1] * v, B = base[2] * v * tb[t];
          if (kd === 1) { R = R * 1.03 + 2; G = G * 1.035 + 3; B = B * 1.06 + 4; } else if (kd === 2) { const a = 0.5 + cloud[p]; R *= 1 - 0.03 * a; G *= 1 - 0.05 * a; B *= 1 - 0.11 * a; }
          R += spec * 255; G += spec * 255; B += spec * 255;
          if (kd !== 1 && dd < 9) { const e = Math.exp(-dd / 2.6) * (0.24 + 0.7 * sstep(0.4, 0.7, gr)); R *= 1 - e * 0.5; G *= 1 - e * 0.55; B *= 1 - e * 0.62; }   // dirt hugging the joints
          if (kd === 3) {                         // chipped corner: bare biscuit showing
            const cx = k1[t] < 0.5 ? iL[t] : tw - iR[t], cy = k2[t] < 0.5 ? iT[t] : th - iB[t], rad = 4 + k3[t] * 7 + (fine[p] - 0.5) * 6, q = Math.hypot(px - cx, py - cy);
            if (q < rad) { const f = 0.75 + fine[p] * 0.5; R = (dark ? 120 : 138) * f; G = (dark ? 104 : 120) * f; B = (dark ? 88 : 100) * f; } else if (q < rad + 1.2) { R *= 0.7; G *= 0.7; B *= 0.7; }
          } else if (kd === 4) {                  // hairline crack
            const a = k1[t] * 3.14, q = Math.abs(Math.cos(a) * (px - tw * (0.3 + k2[t] * 0.4)) + Math.sin(a) * (py - th * (0.3 + k3[t] * 0.4)) + (cloud[p] - 0.5) * 6);
            if (q < 0.9) { const f = 0.5 + q * 0.4; R *= f; G *= f; B *= f; }
          }
          // grout
          const gv = (0.5 + 0.5 * (1 - sstep(0.3, 0.75, gr))) * (0.9 + fine[p] * 0.2), GR = grout[0] * gv, GG = grout[1] * gv, GB = grout[2] * gv;
          R = GR + (R - GR) * cov; G = GG + (G - GG) * cov; B = GB + (B - GB) * cov;
          const k = Math.min(0.75, drip[p]) * (kd === 1 ? 0.3 : 1), nz = 1 + (wn() - 0.5) * 0.028;
          d[p * 4] = R * (1 - k * 0.36) * nz; d[p * 4 + 1] = G * (1 - k * 0.46) * nz; d[p * 4 + 2] = B * (1 - k * 0.62) * nz;
        }
      }
    });
    return texOf(c, W / tw * 0.1524, H / th * 0.0762);
  }

  // ------------------------------------------------------------- concrete family
  function concreteBase(W, H, o) {               // returns { c, ctx, n1, n2 }
    const S = SEED * 977 + o.seed, n1 = fbmField(W, H, o.cells, o.cells, 7, S, 0.55), n2 = fbmField(W, H, o.cells * 3, o.cells * 3, 5, S + 1, 0.6), n3 = fbmField(W, H, 3, 3, 3, S + 2), wn = rng(S + 3);
    const out = pixels(W, H, (d) => {
      for (let p = 0; p < W * H; p++) {
        let v = 1 + (n1[p] - 0.5) * o.contrast + (n2[p] - 0.5) * o.contrast * 0.7 + (wn() - 0.5) * o.speck; const q = wn();
        if (q < o.pits) v *= 0.55 + wn() * 0.25; else if (q > 1 - (o.lights || 0)) v *= 1.14 + wn() * 0.14;
        const w = (n3[p] - 0.5) * (o.warm ?? 0.06);
        d[p * 4] = o.base[0] * v * (1 + w); d[p * 4 + 1] = o.base[1] * v; d[p * 4 + 2] = o.base[2] * v * (1 - w);
      }
    });
    out.n1 = n1; out.n2 = n2; return out;
  }
  function blobs(ctx, W, H, r, n, rmin, rmax, col, amin, amax) {   // soft stains
    const L = []; for (let i = 0; i < n; i++) L.push([r() * W, r() * H, rmin + r() * r() * (rmax - rmin), amin + r() * (amax - amin), 0.6 + r() * 0.8, r() * 3.14]);
    wrap9(ctx, W, H, () => { for (const [x, y, rad, a, sq, rot] of L) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, sq); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rad); g.addColorStop(0, css(col, a)); g.addColorStop(0.6, css(col, a * 0.7)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.fillRect(-rad, -rad, rad * 2, rad * 2); ctx.restore(); } });
  }
  function gum(ctx, W, H, r, n, rmin, rmax) {    // trodden-in chewing gum: flat dark discs, a few pale ones
    const L = []; for (let i = 0; i < n; i++) { const pale = r() < 0.18, g = pale ? 120 + r() * 50 : 22 + r() * 30; L.push([r() * W, r() * H, rmin + r() * (rmax - rmin), 0.7 + r() * 0.5, r() * 3.14, g, 0.5 + r() * 0.42]); }
    wrap9(ctx, W, H, () => { for (const [x, y, rad, sq, rot, g, a] of L) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, sq); ctx.beginPath(); ctx.arc(0, 0, rad, 0, 6.3); ctx.fillStyle = css([g, g * 0.98, g * 0.94], a); ctx.fill(); ctx.beginPath(); ctx.arc(0, 0, rad + 0.8, 0, 6.3); ctx.strokeStyle = css([20, 18, 15], a * 0.25); ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); } });
  }
  function cracks(ctx, W, H, r, n, alpha = 0.6) {
    const L = []; for (let i = 0; i < n; i++) { let x = r() * W, y = r() * H, a = r() * 6.283; const pts = [[x, y]], len = 30 + r() * 110; for (let k = 0; k < len; k++) { a += (r() - 0.5) * 0.7; x += Math.cos(a) * 4; y += Math.sin(a) * 4; pts.push([x, y]); } L.push([pts, 0.7 + r() * 0.9]); }
    wrap9(ctx, W, H, () => { for (const [pts, lw] of L) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const q of pts) ctx.lineTo(q[0], q[1]); ctx.strokeStyle = `rgba(22,20,17,${alpha})`; ctx.lineWidth = lw; ctx.stroke(); ctx.strokeStyle = `rgba(22,20,17,${alpha * 0.2})`; ctx.lineWidth = lw + 3; ctx.stroke(); } });
  }
  // mezzanine / passage floor: 3.6 m, smooth worn concrete scored into 1.2 m squares
  function texFloor() {
    const W = 1024, H = 1024, r = rng(SEED * 31 + 5), o = concreteBase(W, H, { seed: 21, cells: 6, base: [150, 147, 140], contrast: 0.2, speck: 0.07, pits: 0.006, lights: 0.012 }), { c, ctx } = o;
    const S = W / 3;                              // one slab in px
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const t = r(); ctx.fillStyle = t < 0.5 ? `rgba(0,0,0,${t * 0.14})` : `rgba(255,250,235,${(t - 0.5) * 0.12})`; ctx.fillRect(i * S, j * S, S + 1, S + 1); }
    blobs(ctx, W, H, r, 90, 6, 70, [40, 36, 30], 0.03, 0.16); blobs(ctx, W, H, r, 40, 3, 16, [24, 20, 16], 0.1, 0.3); blobs(ctx, W, H, r, 30, 20, 120, [215, 212, 200], 0.03, 0.1);
    cracks(ctx, W, H, r, 3, 0.45);
    wrap9(ctx, W, H, () => { for (let i = 0; i < 3; i++) for (const vert of [0, 1]) { const q = i * S; const g = vert ? ctx.createLinearGradient(q - 9, 0, q + 9, 0) : ctx.createLinearGradient(0, q - 9, 0, q + 9); g.addColorStop(0, 'rgba(30,26,22,0)'); g.addColorStop(0.5, 'rgba(30,26,22,0.22)'); g.addColorStop(1, 'rgba(30,26,22,0)'); ctx.fillStyle = g; if (vert) ctx.fillRect(q - 9, 0, 18, H); else ctx.fillRect(0, q - 9, W, 18); ctx.fillStyle = 'rgba(26,23,20,0.82)'; if (vert) ctx.fillRect(q - 1.2, 0, 2.4, H); else ctx.fillRect(0, q - 1.2, W, 2.4); ctx.fillStyle = 'rgba(235,230,215,0.16)'; if (vert) ctx.fillRect(q + 1.2, 0, 1, H); else ctx.fillRect(0, q + 1.2, W, 1); } });
    gum(ctx, W, H, r, 150, 2.2, 5.2);
    return texOf(c, 3.6, 3.6);
  }
  // platform floor: 3.6 m, rougher, patched, stained
  function texPlatform() {
    const W = 1024, H = 1024, r = rng(SEED * 31 + 6), o = concreteBase(W, H, { seed: 33, cells: 5, base: [128, 124, 116], contrast: 0.34, speck: 0.13, pits: 0.02, lights: 0.02 }), { c, ctx } = o;
    const P = []; for (let i = 0; i < 3; i++) P.push([r() * W, r() * H, 80 + r() * 220, 60 + r() * 160, r() < 0.5 ? [165, 162, 152] : [92, 88, 82], 0.16 + r() * 0.16]);
    wrap9(ctx, W, H, () => { for (const [x, y, w, h, col, a] of P) { ctx.fillStyle = css(col, a); ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(30,27,23,0.28)'; ctx.lineWidth = 1.2; ctx.strokeRect(x, y, w, h); } });   // patch repairs
    blobs(ctx, W, H, r, 130, 8, 90, [34, 30, 25], 0.04, 0.22); blobs(ctx, W, H, r, 70, 3, 18, [20, 17, 14], 0.12, 0.38); blobs(ctx, W, H, r, 30, 20, 110, [200, 196, 184], 0.03, 0.1); blobs(ctx, W, H, r, 14, 10, 40, [96, 62, 34], 0.06, 0.2);
    cracks(ctx, W, H, r, 7, 0.62);
    wrap9(ctx, W, H, () => { const g = ctx.createLinearGradient(-10, 0, 10, 0); g.addColorStop(0, 'rgba(26,23,20,0)'); g.addColorStop(0.5, 'rgba(26,23,20,0.28)'); g.addColorStop(1, 'rgba(26,23,20,0)'); ctx.fillStyle = g; ctx.fillRect(-10, 0, 20, H); ctx.fillStyle = 'rgba(20,18,15,0.85)'; ctx.fillRect(-1.5, 0, 3, H); });   // one cross joint per 3.6 m
    gum(ctx, W, H, r, 230, 2.2, 5.6);
    return texOf(c, 3.6, 3.6);
  }
  // painted ceiling: 3 m
  function texCeiling() {
    const W = 512, H = 512, S = SEED * 53 + 7, r = rng(S), n1 = fbmField(W, H, 4, 4, 6, S + 1), pl = fbmField(W, H, 9, 9, 5, S + 2, 0.62), ws = fbmField(W, H, 5, 5, 5, S + 6, 0.55), n3 = fbmField(W, H, 64, 64, 2, S + 3), wn = rng(S + 4);
    const { c, ctx } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
        const v = 0.86 + n1[p] * 0.26 + (wn() - 0.5) * 0.03, yel = sstep(0.5, 0.7, n1[p]) * 0.1; let R = 196 * v, G = 190 * v * (1 - yel * 0.4), B = 172 * v * (1 - yel);
        if (x % 34 < 1) { R *= 0.93; G *= 0.93; B *= 0.93; }                                    // board marks under the paint
        const wq = ws[p]; if (wq > 0.6) { const e = wq < 0.612 ? 0.2 : 0.07; R *= 1 - e * 0.5; G *= 1 - e * 0.75; B *= 1 - e * 1.2; }
        const q = pl[p] + (n3[p] - 0.5) * 0.05, T = 0.7;
        if (q > T) { const f = 0.75 + n3[p] * 0.5; R = 112 * f; G = 104 * f; B = 92 * f; if (q < T + 0.012) { R *= 0.55; G *= 0.55; B *= 0.55; } }      // paint gone: bare concrete, shadow under the lip
        else if (q > T - 0.014) { R *= 1.09; G *= 1.09; B *= 1.08; }                                                                                 // the curled edge catches light
        else if (q > T - 0.06) { const f = 1 - (q - (T - 0.06)) / 0.046 * 0.08; R *= f; G *= f * 0.99; B *= f * 0.96; }
        d[p * 4] = R; d[p * 4 + 1] = G; d[p * 4 + 2] = B;
      }
    });
    blobs(ctx, W, H, r, 40, 8, 60, [30, 28, 26], 0.04, 0.16);
    return texOf(c, 3, 3);
  }
  // raw tunnel concrete: 3 m, v up, board-formed, soot runs
  function texConcrete() {
    const W = 512, H = 512, S = SEED * 59 + 8, r = rng(S), n1 = fbmField(W, H, 5, 5, 7, S + 1, 0.58), run = fbmField(W, H, 48, 2, 3, S + 2), grain = fbmField(W, H, 3, 96, 2, S + 3), wn = rng(S + 4), bt = []; for (let i = 0; i < 12; i++) bt.push(0.9 + r() * 0.2);
    const { c, ctx } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const fb = y * 12 / H, b = fb | 0, ly = (fb - b) * (H / 12);
        for (let x = 0; x < W; x++, p++) {
          let v = (0.62 + n1[p] * 0.76) * bt[b] * (0.93 + grain[p] * 0.14) + (wn() - 0.5) * 0.12; if (wn() < 0.012) v *= 0.5;
          if (ly < 1.3) v *= 0.66; else if (ly < 2.6) v *= 1.1;                                   // board joint: a dark line with a fin of grout below it
          const s = Math.max(0, run[p] - 0.5) * 2 * sstep(0.38, 0.62, n1[p]); v *= 1 - s * 0.5;
          d[p * 4] = 74 * v; d[p * 4 + 1] = 69 * v; d[p * 4 + 2] = 62 * v * (1 - s * 0.1);
        } }
    });
    const E = []; for (let i = 0; i < 7; i++) E.push([r() * W, r() * H, 30 + r() * 160, 2 + r() * 7, 0.06 + r() * 0.14]);
    wrap9(ctx, W, H, () => { for (const [x, y, len, wd, a] of E) { const g = ctx.createLinearGradient(0, y, 0, y + len); g.addColorStop(0, `rgba(205,200,188,${a})`); g.addColorStop(1, 'rgba(205,200,188,0)'); ctx.fillStyle = g; ctx.fillRect(x, y, wd, len); ctx.fillStyle = `rgba(215,210,198,${a * 0.6})`; ctx.fillRect(x + wd * 0.3, y, Math.max(1, wd * 0.3), len * 0.6); }     // lime runs
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = (i + 0.5) * W / 4, y = (j + 0.5) * H / 4 + 3; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 6.3); ctx.fillStyle = 'rgba(12,11,10,0.8)'; ctx.fill(); ctx.beginPath(); ctx.arc(x, y + 0.8, 3.8, 0.3, 2.8); ctx.strokeStyle = 'rgba(150,145,132,0.3)'; ctx.lineWidth = 1; ctx.stroke(); const g = ctx.createLinearGradient(0, y, 0, y + 40); g.addColorStop(0, 'rgba(60,34,18,0.3)'); g.addColorStop(1, 'rgba(60,34,18,0)'); ctx.fillStyle = g; ctx.fillRect(x - 2, y + 2, 4, 40); } });   // form-tie holes with a rust tear
    blobs(ctx, W, H, r, 50, 6, 60, [14, 13, 12], 0.06, 0.25);
    return texOf(c, 3, 3);
  }
  // track pit floor: u 2.4 m along the track (512 px), v 3.0 m across (1024 px), centre at v = 1.5
  function texTrackbed() {
    const W = 512, H = 1024, S = SEED * 61 + 9, r = rng(S), n1 = fbmField(W, H, 4, 5, 7, S + 1, 0.58), n2 = fbmField(W, H, 16, 20, 4, S + 2), grain = fbmField(W, H, 128, 4, 2, S + 3), wn = rng(S + 4);
    const { c, ctx } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const cv = (1 - (y + 0.5) / H) * 3.0, dc = Math.abs(cv - 1.5), drl = Math.abs(dc - 0.7175);
        for (let x = 0; x < W; x++, p++) {
          const a = (x + 0.5) / W * 2.4, ta = a % 0.6, nA = n1[p], nB = n2[p];
          let v = 0.6 + nA * 0.8 + (wn() - 0.5) * 0.16, R = 62 * v, G = 57 * v, B = 51 * v; if (wn() < 0.02) { R *= 0.5; G *= 0.5; B *= 0.5; }
          const te = Math.min(ta - 0.19, 0.41 - ta), tEnd = 1.3 + (nB - 0.5) * 0.03, tIn = 0.23 + (nB - 0.5) * 0.02;
          if (te > 0 && dc > tIn && dc < tEnd) {                                                 // timber tie, set in the concrete either side of the drain
            const g = 0.55 + grain[p] * 0.9 + (wn() - 0.5) * 0.1; R = 58 * g; G = 45 * g; B = 33 * g;
            const ee = Math.min(te, dc - tIn, tEnd - dc); if (ee < 0.012) { R *= 0.5; G *= 0.5; B *= 0.5; } else if (ee < 0.03) { R *= 0.82; G *= 0.82; B *= 0.82; }
            if (drl < 0.16 && te > 0.02) { const pe = Math.min(0.16 - drl, te - 0.02); let f = 0.75 + nB * 0.3; if (pe < 0.008) f *= 0.5; R = 46 * f; G = 40 * f; B = 37 * f; }   // tie plate
          } else if (te > -0.02 && dc > tIn - 0.02 && dc < tEnd + 0.02) { R *= 0.6; G *= 0.6; B *= 0.6; }
          if (dc < 0.2) {                                                                        // drain trough down the middle: dark and wet
            const k = sstep(0.2, 0.15, dc); R *= 1 - k * 0.55; G *= 1 - k * 0.52; B *= 1 - k * 0.46; if (dc > 0.185) { R *= 0.55; G *= 0.55; B *= 0.55; }
            const wet = sstep(0.52, 0.62, nA) * k * (0.5 + nB * 0.5); R += wet * 7; G += wet * 9; B += wet * 12;
          }
          if (drl < 0.2) { const k = (1 - drl / 0.2) * (0.25 + nB * 0.5); R += (104 - R) * k * 0.6; G += (58 - G) * k * 0.6; B += (30 - B) * k * 0.6; }          // rust and brake dust under the rails
          const gr = 0.78 + nB * 0.44; d[p * 4] = R * gr; d[p * 4 + 1] = G * gr; d[p * 4 + 2] = B * gr;
        } }
    });
    const L = []; for (let i = 0; i < 26; i++) { const mid = r() < 0.6; L.push([r() * W, mid ? H / 2 + (r() - 0.5) * 120 : r() * H, 1.5 + r() * 4, 2 + r() * 7, r() * 3.14, r() < 0.3 ? [150, 60, 40] : [178 - r() * 60, 172 - r() * 60, 158 - r() * 60], 0.25 + r() * 0.45]); }
    wrap9(ctx, W, H, () => { for (const [x, y, w, h, rot, col, a] of L) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = css(col, a); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore(); } });   // litter
    blobs(ctx, W, H, r, 40, 8, 60, [10, 9, 8], 0.08, 0.3);
    return texOf(c, 2.4, 3.0);
  }
  // stair: 1.2 x 1.2 m. v 0..0.055 nosing, to 0.33 tread, above that plain riser concrete
  function texStair() {
    const W = 512, H = 512, S = SEED * 67 + 10, n1 = fbmField(W, H, 6, 6, 6, S + 1, 0.58), n2 = fbmField(W, H, 24, 24, 3, S + 2), run = fbmField(W, H, 64, 2, 3, S + 3), wear = fbmField(W, H, 3, 24, 3, S + 5), wn = rng(S + 4);
    const { c } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const v = (1 - (y + 0.5) / H) * 1.2;
        for (let x = 0; x < W; x++, p++) {
          const u = (x + 0.5) / W * 1.2; let k = 0.74 + n1[p] * 0.52 + (wn() - 0.5) * 0.11, R, G, B; if (wn() < 0.012) k *= 0.6;
          if (v < 0.055) {                                                                        // nosing: yellow paint over a cast tread plate, worn through
            const a = (u * 45 + v * 45) % 1, b = ((u * 45 - v * 45) % 1 + 1) % 1, groove = (a < 0.2 || b < 0.2) ? 0.72 : 1, worn = sstep(0.42, 0.6, wear[p] * 0.6 + n2[p] * 0.4);
            const kk = (0.8 + n1[p] * 0.4) * groove; R = (206 + (66 - 206) * worn) * kk; G = (160 + (62 - 160) * worn) * kk; B = (26 + (58 - 26) * worn) * kk; if (v > 0.05) { R *= 0.6; G *= 0.6; B *= 0.6; }
          } else if (v < 0.36) {                                                                  // tread: polished pale where feet land, black in the back corner
            const t = (v - 0.055) / 0.275, foot = Math.exp(-((t - 0.38) * (t - 0.38)) / 0.05) * (0.3 + wear[p] * 0.9) * 0.15, back = sstep(0.62, 1.0, t) * (0.3 + n2[p] * 0.4);
            k *= (1 + foot) * (1 - back); if (v < 0.063) k *= 0.6; R = 132 * k; G = 128 * k; B = 119 * k;
          } else { const s = Math.max(0, run[p] - 0.52) * 2 * sstep(0.4, 0.65, n1[p]); k *= (1 - s * 0.3) * (v < 0.4 ? 0.8 : 1); R = 116 * k; G = 111 * k; B = 102 * k; }   // riser: shoe scuffs and runs
          d[p * 4] = R; d[p * 4 + 1] = G; d[p * 4 + 2] = B;
        } }
    });
    return texOf(c, 1.2, 1.2);
  }
  // tactile edge strip: 2.4 x 0.6 m, truncated domes at 60 mm
  function texEdge() {
    const W = 1024, H = 256, S = SEED * 71 + 11, r = rng(S), n1 = fbmField(W, H, 8, 2, 6, S + 1, 0.58), n2 = fbmField(W, H, 32, 8, 4, S + 2, 0.6), wn = rng(S + 3), sp = 25.6, pt = []; for (let i = 0; i < 4; i++) pt.push(0.92 + r() * 0.14);
    const { c, ctx } = pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const iy = Math.floor(y / sp), dy = y + 0.5 - (iy + 0.5) * sp;
        for (let x = 0; x < W; x++, p++) {
          const ix = Math.floor(x / sp), dx = x + 0.5 - (ix + 0.5) * sp, q = Math.hypot(dx, dy), pn = pt[(x / 256) | 0];
          let v = (0.82 + n1[p] * 0.36) * pn + (wn() - 0.5) * 0.07, dirt = sstep(0.38, 0.72, n2[p] * 0.6 + n1[p] * 0.4) * 0.6;
          if (q < 3.6) { v *= 1.07; dirt = dirt * 0.5 + sstep(0.45, 0.7, n2[p]) * 0.5; }           // flat top: scuffed
          else if (q < 6.6) { v *= 1 + 0.2 * (-dy / q) + 0.05 * (-dx / q); dirt *= 0.6; }           // the slope: lit from one side
          else if (q < 9) { const sh = (1 - (q - 6.6) / 2.4); v *= 1 - sh * (0.16 + 0.14 * Math.max(0, dy / q)); dirt = Math.min(1, dirt + sh * 0.25); }   // dirt ring round the foot of each dome
          if (x % 256 < 1.6) v *= 0.45; else if (x % 256 < 3) v *= 0.85; if (y < 2 || y > H - 3) v *= 0.6;
          let R = 228 * v, G = 176 * v, B = 24 * v; R += (78 - R) * dirt; G += (68 - G) * dirt; B += (48 - B) * dirt;
          d[p * 4] = R; d[p * 4 + 1] = G; d[p * 4 + 2] = B;
        } }
    });
    const L = []; for (let i = 0; i < 26; i++) L.push([r() * W, r() * H, 10 + r() * 50, r() * 3.14, 1 + r() * 3, 0.08 + r() * 0.18]);
    wrap9(ctx, W, H, () => { for (const [x, y, len, a, lw, al] of L) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len * 0.3); ctx.strokeStyle = `rgba(20,18,16,${al})`; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke(); } });   // black scuffs
    gum(ctx, W, H, r, 14, 2.5, 5);
    return texOf(c, 2.4, 0.6);
  }
  // painted riveted steel: 0.6 x 1.2 m
  function texSteel() {
    const W = 256, H = 512, S = SEED * 73 + 12, r = rng(S), n1 = fbmField(W, H, 4, 8, 6, S + 1, 0.58), chip = fbmField(W, H, 6, 12, 6, S + 2, 0.62), brush = fbmField(W, H, 64, 4, 2, S + 3), wn = rng(S + 4);
    const { c, ctx } = pixels(W, H, (d) => {
      for (let p = 0; p < W * H; p++) {
        const v = 0.72 + n1[p] * 0.42 + (brush[p] - 0.5) * 0.2 + (wn() - 0.5) * 0.06; let R = 34 * v, G = 50 * v, B = 41 * v; const q = chip[p] + (n1[p] - 0.5) * 0.3, T = 0.73;
        if (q > T) { const f = 0.6 + n1[p] * 0.8 + (wn() - 0.5) * 0.3; R = 104 * f; G = 58 * f; B = 34 * f; if (q > T + 0.05) { R = 62 * f; G = 44 * f; B = 36 * f; } if (q < T + 0.008) { R *= 0.5; G *= 0.5; B *= 0.5; } }   // paint gone: primer red, then rust
        else if (q > T - 0.012) { R *= 1.35; G *= 1.3; B *= 1.3; }
        d[p * 4] = R; d[p * 4 + 1] = G; d[p * 4 + 2] = B;
      }
    });
    const px = W / 0.6, rad = 0.0115 * px;
    wrap9(ctx, W, H, () => { for (const u of [0.04, 0.26, 0.34, 0.56]) for (let j = 0; j < 12; j++) { const x = u * px, y = (j + 0.5) * 0.1 * px;
      ctx.beginPath(); ctx.arc(x + 0.8, y + 1.6, rad + 1.2, 0, 6.3); ctx.fillStyle = 'rgba(6,9,8,0.55)'; ctx.fill();
      const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.45, 0.3, x, y, rad); g.addColorStop(0, 'rgb(92,116,102)'); g.addColorStop(0.45, 'rgb(44,62,52)'); g.addColorStop(1, 'rgb(20,30,25)'); ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.3); ctx.fillStyle = g; ctx.fill();
      if ((j * 7 + Math.round(u * 100)) % 5 === 0) { const gg = ctx.createLinearGradient(0, y, 0, y + 46); gg.addColorStop(0, 'rgba(110,60,30,0.4)'); gg.addColorStop(1, 'rgba(110,60,30,0)'); ctx.fillStyle = gg; ctx.fillRect(x - 1.5, y + rad, 3, 46); } } });
    blobs(ctx, W, H, r, 20, 6, 40, [8, 10, 9], 0.08, 0.25);
    return texOf(c, 0.6, 1.2);
  }
  // brushed stainless: 0.5 m, brushed along u
  function texMetal() {
    const W = 256, H = 256, S = SEED * 79 + 13, r = rng(S), a = fbmField(W, H, 2, 128, 1, S + 1), b = fbmField(W, H, 8, 64, 2, S + 2), n = fbmField(W, H, 3, 3, 4, S + 3), wn = rng(S + 4);
    const { c, ctx } = pixels(W, H, (d) => { for (let p = 0; p < W * H; p++) { const v = 0.82 + (a[p] - 0.5) * 0.13 + (b[p] - 0.5) * 0.07 + (n[p] - 0.5) * 0.2 + (wn() - 0.5) * 0.04; d[p * 4] = 172 * v; d[p * 4 + 1] = 175 * v; d[p * 4 + 2] = 178 * v; } });
    blobs(ctx, W, H, r, 14, 8, 40, [60, 58, 54], 0.04, 0.12);
    return texOf(c, 0.5, 0.5);
  }
  // running rail: u 1 m, v 0.28 m (0..0.07 head)
  function texRail() {
    const W = 256, H = 128, S = SEED * 83 + 14, a = fbmField(W, H, 2, 64, 1, S + 1), n = fbmField(W, H, 8, 4, 4, S + 2), wn = rng(S + 3);
    const { c } = pixels(W, H, (d) => { for (let y = 0, p = 0; y < H; y++) { const v = (1 - (y + 0.5) / H) * 0.28; for (let x = 0; x < W; x++, p++) {
      let R, G, B; const k = 0.75 + n[p] * 0.5 + (wn() - 0.5) * 0.1;
      if (v < 0.07) { const t = v / 0.07, br = sstep(0.14, 0.3, t) * (1 - sstep(0.7, 0.88, t)) * (0.85 + (a[p] - 0.5) * 0.3); R = 66 * k + (212 - 66 * k) * br; G = 50 * k + (214 - 50 * k) * br; B = 40 * k + (220 - 40 * k) * br; }
      else { R = 60 * k; G = 43 * k; B = 33 * k; if (v < 0.1) { R *= 0.5; G *= 0.5; B *= 0.5; } }
      d[p * 4] = R; d[p * 4 + 1] = G; d[p * 4 + 2] = B; } } });
    return texOf(c, 1, 0.28);
  }

  // ------------------------------------------------------------- lazy material table
  const builders = {
    tile: () => litMat(texTile(false), macro('wall')),
    tileDark: () => litMat(texTile(true), macro('wall')),
    floor: () => litMat(texFloor(), macro('floor')),
    platform: () => litMat(texPlatform(), macro('floor')),
    edge: () => litMat(texEdge(), macro('floor')),
    stair: () => litMat(texStair(), null),
    ceiling: () => litMat(texCeiling(), macro('ceil')),
    concrete: () => litMat(texConcrete(), macro('ceil')),
    trackbed: () => litMat(texTrackbed(), null),
    steel: () => litMat(texSteel(), null),
    metal: () => litMat(texMetal(), null),
    rail: () => litMat(texRail(), null),
    black: () => { const m = new THREE.MeshBasicMaterial({ color: 0x050505, vertexColors: true, fog: false }); materials.push(m); return m; },
    glowWarm: () => glow(4.0, 2.9, 1.7), glowWhite: () => glow(4.0, 4.0, 4.0), glowRed: () => glow(4.0, 0.22, 0.12), glowGreen: () => glow(0.25, 4.0, 0.7),
  };
  const mat = {};
  for (const k of Object.keys(builders)) Object.defineProperty(mat, k, { enumerable: true, get() { if (!cache.has('mat:' + k)) cache.set('mat:' + k, builders[k]()); return cache.get('mat:' + k); } });

  // ------------------------------------------------------------- mosaic (tablet and band)
  // cellColor(i, j) -> [r,g,b] for the tessera at column i, row j (row 0 at the top); mask (optional, Uint8 W*H) switches to `ink` inside letters.
  function mosaic(cols, rows, T, cellColor, mask, ink, seed, tileable) {
    const W = cols * T, H = rows * T, r = rng(seed), n = cols * rows, cr = new Float32Array(n), cg = new Float32Array(n), cb = new Float32Array(n), sh = new Float32Array(n), ins = new Float32Array(n * 4), gl = new Float32Array(n), ih = new Float32Array(n);
    for (let j = 0, t = 0; j < rows; j++) for (let i = 0; i < cols; i++, t++) { const c = cellColor(i, j); cr[t] = c[0]; cg[t] = c[1]; cb[t] = c[2]; sh[t] = 1 + (r() - 0.5) * 0.3 + (r() < 0.1 ? (r() - 0.5) * 0.3 : 0); ih[t] = 1 + (r() - 0.5) * 0.2; gl[t] = r() < 0.08 ? 0.1 + r() * 0.16 : 0; for (let k = 0; k < 4; k++) ins[t * 4 + k] = 0.3 + r() * 0.9; }
    const gr = fbmField(tileable ? W : 1 << Math.ceil(Math.log2(W)), 1 << Math.ceil(Math.log2(H)), 4, 2, 5, seed + 1), gw = tileable ? W : 1 << Math.ceil(Math.log2(W)), wn = rng(seed + 2);
    return pixels(W, H, (d) => {
      for (let y = 0, p = 0; y < H; y++) { const j = (y / T) | 0, py = y - j * T + 0.5;
        for (let x = 0; x < W; x++, p++) {
          const i = (x / T) | 0, px = x - i * T + 0.5, t = j * cols + i, dd = Math.min(px - ins[t * 4], T - ins[t * 4 + 1] - px, py - ins[t * 4 + 2], T - ins[t * 4 + 3] - py), g = gr[y * gw + x];
          let cov = clamp01(dd + 0.5), R = cr[t], G = cg[t], B = cb[t], s = sh[t];
          if (mask) { const m = mask[p]; if (m > 200) { R = ink[0]; G = ink[1]; B = ink[2]; s = ih[t]; } else if (m > 50) cov = 0; }     // the cut line round each letter
          s *= 1 + (py / T - 0.5) * -0.12 + (dd < 1.6 ? -0.06 : 0) + gl[t] * (1 - px / T) + (wn() - 0.5) * 0.05;
          const dirt = sstep(0.45, 0.75, g); s *= 1 - dirt * 0.22;
          const gv = 0.6 + (1 - dirt) * 0.5, GR = 96 * gv, GG = 90 * gv, GB = 80 * gv;
          d[p * 4] = GR + (R * s - GR) * cov; d[p * 4 + 1] = GG + (G * s - GG) * cov; d[p * 4 + 2] = GB + (B * s - GB) * cov;
        } }
    });
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const CREAM = [232, 225, 204];

  // NAME TABLET. text may hold '\n' for two lines. o: { color = field colour, accent = border colour, h = 0.9, maxW, serif = true }
  // returns { material, map, w, h }: a w x h metre quad, UV 0..1. The material takes VERTEX COLOURS like the wall it sits on.
  function tablet(text, o = {}) {
    const key = 'tablet:' + JSON.stringify([text, o]); if (cache.has(key)) return cache.get(key);
    const h = o.h ?? 0.9, T = 8, rows = Math.max(16, Math.round(h / 0.02)), tm = h / rows, H = rows * T, field = hexRgb(o.color ?? '#1d3f7a'), accent = hexRgb(o.accent ?? '#c9972e'), lines = String(text).toUpperCase().split('\n');
    const B = 5, inner = rows - 2 * B, capT = Math.min(inner * 0.56, (inner - 3) / lines.length * 0.72), cap = capT * T;       // cap height in px
    const mc = mkCanvas(8, 8), mx = mc.getContext('2d'), font = `700 ${cap / 0.7}px ${o.serif === false ? SANS : SERIF}`;
    mx.font = font; try { mx.letterSpacing = `${cap * 0.1}px`; } catch (e) { /* older browsers */ }
    let tw = 0; for (const l of lines) tw = Math.max(tw, mx.measureText(l).width);
    let cols = Math.ceil((tw + cap * 1.3) / T) + 2 * B, sq = 1; if (o.maxW && cols * tm > o.maxW) { const c2 = Math.floor(o.maxW / tm); sq = (c2 - 2 * B - cap * 1.0 / T) * T / tw; cols = c2; }
    cols = Math.min(cols, Math.floor(2048 / T)); const W = cols * T; if (tw * sq > W - 2 * B * T - cap * 0.6) sq = (W - 2 * B * T - cap * 0.6) / tw;
    mc.width = W; mc.height = H; mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H); mx.fillStyle = '#fff'; mx.font = font; try { mx.letterSpacing = `${cap * 0.1}px`; } catch (e) { /* */ } mx.textAlign = 'center'; mx.textBaseline = 'alphabetic';
    const pitch = inner * T / lines.length;
    lines.forEach((l, k) => { mx.save(); mx.translate(W / 2 + cap * 0.05, B * T + pitch * (k + 0.5) + cap / 2); mx.scale(sq, 1); mx.fillText(l, 0, 0); mx.restore(); });
    const md = mx.getImageData(0, 0, W, H).data, mask = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) mask[p] = md[p * 4];
    const dark = mixc(field, [10, 10, 12], 0.55), acc2 = mixc(accent, [40, 22, 10], 0.45);
    const cell = (i, j) => { const db = Math.min(i, j, cols - 1 - i, rows - 1 - j), along = (j === db || j === rows - 1 - db) ? i : j;
      if (db === 0) return dark; if (db === 1) return CREAM; if (db === 2) return (Math.floor(along / 3) % 2) ? accent : acc2; if (db === 3) return CREAM; if (db === 4) return dark; return field; };
    const { c } = mosaic(cols, rows, T, cell, mask, CREAM, SEED * 7 + cols * 13 + text.length, false);
    const map = texOf(c), out = { material: litMat(map, null), map, w: cols * tm, h };
    cache.set(key, out); return out;
  }
  // BAND COURSE: tiling mosaic strip, u in metres, v 0..h. o: { color, accent, h = 0.25 }. Returns a material (vertex colours on).
  function band(o = {}) {
    const key = 'band:' + JSON.stringify(o); if (cache.has(key)) return cache.get(key);
    const h = o.h ?? 0.25, rows = 12, cols = 64, T = 12, field = hexRgb(o.color ?? '#1d3f7a'), accent = hexRgb(o.accent ?? '#c9972e'), dark = mixc(field, [10, 10, 12], 0.55);
    const cell = (i, j) => { if (j === 0 || j === rows - 1) return dark; if (j === 1 || j === rows - 2) return CREAM; const a = Math.abs((i % 16) - 7.5), b = Math.abs(j - 5.5), q = a + b; if (q < 1.5) return CREAM; if (q < 3.5) return accent; return field; };
    const { c } = mosaic(cols, rows, T, cell, null, null, SEED * 7 + 5, true), map = texOf(c, cols * h / rows, h), m = litMat(map, null);
    m.userData.h = h; cache.set(key, m); return m;
  }

  // ------------------------------------------------------------- enamel signs
  function enamel(ctx, W, H, o = {}) {           // board: near black, a faint sheen, keyline, fixings, a little dust
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, o.top || '#1b1c1f'); g.addColorStop(0.5, o.mid || '#0d0d0f'); g.addColorStop(1, o.bot || '#09090a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = rng(W * 7 + H); for (let i = 0; i < W * H / 900; i++) { ctx.fillStyle = `rgba(190,185,170,${r() * 0.06})`; ctx.fillRect(r() * W, r() * r() * H, 1 + r() * 2, 1 + r() * 2); }
    const k = o.inset ?? Math.max(3, H * 0.02); ctx.strokeStyle = o.key || 'rgba(255,255,255,0.2)'; ctx.lineWidth = Math.max(1.5, k * 0.3); rrect(ctx, k, k, W - 2 * k, H - 2 * k, k * 1.4); ctx.stroke();
    if (o.screws !== false) for (const [x, y] of [[k * 2.6, k * 2.6], [W - k * 2.6, k * 2.6], [k * 2.6, H - k * 2.6], [W - k * 2.6, H - k * 2.6]]) { ctx.beginPath(); ctx.arc(x, y, k * 0.75, 0, 6.3); ctx.fillStyle = '#6d6f72'; ctx.fill(); ctx.beginPath(); ctx.arc(x - k * 0.15, y - k * 0.2, k * 0.35, 0, 6.3); ctx.fillStyle = '#a9abad'; ctx.fill(); }
  }
  // DIRECTION SIGN. lines: [{ text, routes: [...], arrow: 'left'|'right'|'up'|'down'|'upleft'|... |null }], o: { h = 0.45 (m per line), maxW (m) }
  // Our own layout: a colour bar of the first route at the left, arrow, text, badges ranged right. Returns { material, map, w, h }, self-lit about 1.0.
  function sign(lines, o = {}) {
    const key = 'sign:' + JSON.stringify([lines, o]); if (cache.has(key)) return cache.get(key);
    lines = (Array.isArray(lines) ? lines : [lines]).map((l) => (typeof l === 'string' ? { text: l } : l));
    const lh = o.h ?? 0.45; let LH = 160; const mc = mkCanvas(8, 8).getContext('2d');
    const lay = (LH) => { const pad = LH * 0.3, bs = LH * 0.56, fs = LH * 0.4, as = LH * 0.5, gap = LH * 0.2; mc.font = `600 ${fs}px ${SANS}`;
      const L = lines.map((l) => { const tw = l.text ? mc.measureText(l.text).width : 0, nb = (l.routes || []).length, bw = nb ? nb * bs + (nb - 1) * bs * 0.14 : 0, left = l.arrow && l.arrow !== 'right' && l.arrow !== 'upright' && l.arrow !== 'downright', right = l.arrow && !left;
        return { ...l, tw, bw, left, right, need: pad + LH * 0.1 + (left ? as + gap : 0) + tw + (nb ? gap * 1.5 + bw : 0) + (right ? gap + as : 0) + pad }; });
      return { pad, bs, fs, as, gap, L, W: Math.max(LH * 2, ...L.map((q) => q.need)) }; };
    let g = lay(LH), W = g.W; const maxPx = Math.min(2048, o.maxW ? o.maxW / lh * LH : 1e9);
    if (W > maxPx) W = maxPx;
    W = Math.ceil(W); const H = LH * lines.length, c = mkCanvas(W, H), ctx = c.getContext('2d');
    enamel(ctx, W, H, { inset: LH * 0.035 });
    g.L.forEach((l, k) => {
      const y0 = k * LH, cy = y0 + LH / 2, sq = Math.min(1, (W - (l.need - l.tw)) / Math.max(1, l.tw));   // squeeze the words if the board is capped
      if (k) { ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(g.pad, y0 - 1, W - 2 * g.pad, 2); }
      const R0 = ROUTES[(l.routes || [])[0]]; ctx.fillStyle = R0 ? R0.color : '#e9e9e4'; rrect(ctx, g.pad * 0.45, y0 + LH * 0.2, LH * 0.055, LH * 0.6, LH * 0.02); ctx.fill();
      let x = g.pad + LH * 0.1;
      if (l.left) { drawArrow(ctx, x + g.as / 2, cy, g.as, l.arrow, '#f4f3ee'); x += g.as + g.gap; }
      if (l.text) { ctx.save(); ctx.translate(x, cy); ctx.scale(Math.max(0.5, sq), 1); ctx.font = `600 ${g.fs}px ${SANS}`; ctx.fillStyle = '#f4f3ee'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(l.text, 0, LH * 0.02); ctx.restore(); }
      let xr = W - g.pad; if (l.right) { drawArrow(ctx, xr - g.as / 2, cy, g.as, l.arrow, '#f4f3ee'); xr -= g.as + g.gap; }
      const rs = l.routes || []; let bx = xr - l.bw; for (const id of rs) { drawBadge(ctx, id, bx, cy - g.bs / 2, g.bs); bx += g.bs * 1.14; }
    });
    const map = texOf(c), out = { material: selfMat(map), map, w: W / LH * lh, h: lh * lines.length }; cache.set(key, out); return out;
  }
  // one badge alone. o: { size = 0.3 (m) }
  function badge(route, o = {}) {
    const key = 'badge:' + route; let map = cache.get(key);
    if (!map) { const c = mkCanvas(128, 128), ctx = c.getContext('2d'); drawBadge(ctx, route, 0, 0, 128); map = texOf(c); cache.set(key, map); }
    const mk = 'badgemat:' + route; if (!cache.has(mk)) { const m = selfMat(map); m.alphaTest = 0.5; cache.set(mk, m); }
    const s = o.size ?? 0.3; return { material: cache.get(mk), map, w: s, h: s };
  }
  // STREET ENTRANCE plate. o: { h = 0.6 (m), maxW }. Returns { material (self-lit basic), map (plain texture for a lit material), w, h }.
  function entranceSign(station, routes = [], o = {}) {
    const key = 'ent:' + JSON.stringify([station, routes, o]); if (cache.has(key)) return cache.get(key);
    const h = o.h ?? 0.6, H = 256, mc = mkCanvas(8, 8).getContext('2d'), fs = H * 0.27, bs = H * 0.27, pad = H * 0.16, ic = H * 0.56;
    mc.font = `700 ${fs}px ${SANS}`; const tw = mc.measureText(station).width, bw = routes.length * bs * 1.14, need = pad + ic + pad * 0.9 + Math.max(tw, bw + H * 0.02) + pad;
    const W = Math.ceil(Math.min(2048, o.maxW ? o.maxW / h * H : 1e9, need)), sq = Math.min(1, (W - (need - Math.max(tw, bw))) / Math.max(tw, bw)), c = mkCanvas(W, H), ctx = c.getContext('2d');
    enamel(ctx, W, H, { top: '#1c2422', mid: '#111715', bot: '#0c100f', inset: H * 0.03 });
    // stairs-down pictogram in a pale square
    const ix = pad, iy = (H - ic) / 2 - H * 0.03; rrect(ctx, ix, iy, ic, ic, ic * 0.14); ctx.fillStyle = '#f1efe8'; ctx.fill();
    ctx.strokeStyle = '#111715'; ctx.lineWidth = ic * 0.085; ctx.lineJoin = 'miter'; ctx.lineCap = 'butt'; ctx.beginPath(); const s = ic * 0.17; let px = ix + ic * 0.14, py = iy + ic * 0.3; ctx.moveTo(px, py); for (let k = 0; k < 3; k++) { px += s; ctx.lineTo(px, py); py += s; ctx.lineTo(px, py); } ctx.lineTo(ix + ic * 0.86, py); ctx.stroke();
    drawArrow(ctx, ix + ic * 0.7, iy + ic * 0.34, ic * 0.34, 'downright', '#111715');
    const x0 = pad + ic + pad * 0.9; ctx.save(); ctx.translate(x0, H * 0.34); ctx.scale(Math.max(0.5, sq), 1); ctx.font = `700 ${fs}px ${SANS}`; ctx.fillStyle = '#f4f3ee'; ctx.textBaseline = 'middle'; ctx.fillText(station, 0, 0);
    let bx = 0; for (const id of routes) { drawBadge(ctx, id, bx, H * 0.21, bs); bx += bs * 1.14; } ctx.restore();
    // foot stripe in the colours of the lines that stop here (our own device)
    const cols = [...new Set(routes.map((id) => (ROUTES[id] || {}).color).filter(Boolean))]; const sy = H * 0.885, sh = H * 0.05, sw = (W - 2 * pad) / Math.max(1, cols.length); cols.forEach((col, k) => { ctx.fillStyle = col; ctx.fillRect(pad + k * sw, sy, sw + 0.5, sh); });
    const map = texOf(c), out = { material: selfMat(map), map, w: W / H * h, h }; cache.set(key, out); return out;
  }
  // EXIT sign: white letters on a lit red box. o: { h = 0.22, arrow, gain = 1.7 }
  function exitSign(text = 'EXIT', o = {}) {
    const key = 'exit:' + JSON.stringify([text, o]); if (cache.has(key)) return cache.get(key);
    const h = o.h ?? 0.22, H = 128, mc = mkCanvas(8, 8).getContext('2d'), fs = H * 0.54, pad = H * 0.3, as = H * 0.5; mc.font = `700 ${fs}px ${SANS}`; try { mc.letterSpacing = `${fs * 0.06}px`; } catch (e) { /* */ }
    const tw = mc.measureText(text).width, W = Math.ceil(pad * 2 + tw + (o.arrow ? as + pad * 0.6 : 0)), c = mkCanvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1a1c'; ctx.fillRect(0, 0, W, H); const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b9140f'); g.addColorStop(0.5, '#e02a1c'); g.addColorStop(1, '#a8100c'); rrect(ctx, 5, 5, W - 10, H - 10, 7); ctx.fillStyle = g; ctx.fill();
    const left = o.arrow && /left/.test(o.arrow) || o.arrow === 'up' || o.arrow === 'down'; let x = pad; if (o.arrow && left) { drawArrow(ctx, x + as / 2, H / 2, as, o.arrow, '#fff'); x += as + pad * 0.6; }
    ctx.font = `700 ${fs}px ${SANS}`; try { ctx.letterSpacing = `${fs * 0.06}px`; } catch (e) { /* */ } ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(255,220,200,0.6)'; ctx.shadowBlur = 8; ctx.fillText(text, x, H / 2 + 2); ctx.shadowBlur = 0;
    if (o.arrow && !left) drawArrow(ctx, W - pad - as / 2, H / 2, as, o.arrow, '#fff');
    const map = texOf(c), out = { material: selfMat(map, o.gain ?? 1.7), map, w: W / H * h, h }; cache.set(key, out); return out;
  }

  // ------------------------------------------------------------- posters (all invented; no real brands or agencies)
  const POSTERS = [
    (x, W, H) => {   // service notice
      x.fillStyle = '#f3f0e6'; x.fillRect(0, 0, W, H); x.fillStyle = '#16171a'; x.fillRect(0, 0, W, H * 0.17); x.fillStyle = '#f6c21a'; x.fillRect(0, H * 0.17, W, H * 0.022);
      x.fillStyle = '#fff'; x.font = `700 ${H * 0.062}px ${SANS}`; x.fillText('Service change', W * 0.07, H * 0.085); x.font = `500 ${H * 0.03}px ${SANS}`; x.fillStyle = '#c9c9c4'; x.fillText('Planned work, nights and weekends', W * 0.07, H * 0.135);
      drawBadge(x, 'F', W * 0.07, H * 0.25, H * 0.085); drawBadge(x, 'M', W * 0.07 + H * 0.098, H * 0.25, H * 0.085);
      x.fillStyle = '#16171a'; x.font = `700 ${H * 0.046}px ${SANS}`; x.fillText('No trains at this', W * 0.07, H * 0.4); x.fillText('platform after 11 pm', W * 0.07, H * 0.455);
      x.font = `500 ${H * 0.027}px ${SANS}`; x.fillStyle = '#3a3b3e'; ['Trains run on the express track.', 'Use the platform across the', 'mezzanine, or take the D to', '34 St and change there.', '', 'Allow ten more minutes.'].forEach((l, i) => x.fillText(l, W * 0.07, H * (0.53 + i * 0.04)));
      x.strokeStyle = '#16171a'; x.lineWidth = H * 0.004; x.beginPath(); x.moveTo(W * 0.07, H * 0.8); x.lineTo(W * 0.93, H * 0.8); x.stroke(); x.font = `500 ${H * 0.02}px ${SANS}`; x.fillStyle = '#6a6b6e'; x.fillText('City Transit · Notice 0417 · Thank you for your patience', W * 0.07, H * 0.835);
      for (let i = 0; i < 9; i++) { x.fillStyle = i % 2 ? '#16171a' : '#f6c21a'; x.fillRect(W * 0.07 + i * W * 0.0956, H * 0.9, W * 0.0956, H * 0.035); }
    },
    (x, W, H) => {   // tea
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e8b26a'); g.addColorStop(1, '#b4492a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgba(255,240,210,0.25)'; x.beginPath(); x.arc(W * 0.5, H * 0.46, W * 0.44, 0, 6.3); x.fill();
      x.fillStyle = '#fbf3e2'; x.beginPath(); x.ellipse(W * 0.5, H * 0.47, W * 0.26, W * 0.08, 0, 0, 6.3); x.fill(); x.beginPath(); x.moveTo(W * 0.24, H * 0.47); x.quadraticCurveTo(W * 0.27, H * 0.66, W * 0.5, H * 0.66); x.quadraticCurveTo(W * 0.73, H * 0.66, W * 0.76, H * 0.47); x.fill();
      x.fillStyle = '#6b2f14'; x.beginPath(); x.ellipse(W * 0.5, H * 0.47, W * 0.22, W * 0.06, 0, 0, 6.3); x.fill(); x.strokeStyle = '#fbf3e2'; x.lineWidth = W * 0.035; x.beginPath(); x.arc(W * 0.8, H * 0.54, W * 0.07, -1.4, 1.6); x.stroke();
      x.strokeStyle = 'rgba(255,250,235,0.7)'; x.lineWidth = W * 0.012; x.lineCap = 'round'; for (let i = 0; i < 3; i++) { x.beginPath(); const sx = W * (0.4 + i * 0.1); x.moveTo(sx, H * 0.4); x.bezierCurveTo(sx - W * 0.05, H * 0.34, sx + W * 0.05, H * 0.3, sx, H * 0.24); x.stroke(); }
      x.fillStyle = '#fff6e4'; x.textAlign = 'center'; x.font = `700 ${H * 0.085}px ${SERIF}`; x.fillText('Kettlewick', W / 2, H * 0.13); x.font = `italic 500 ${H * 0.034}px ${SERIF}`; x.fillText('tea for the long way home', W / 2, H * 0.185);
      x.font = `600 ${H * 0.03}px ${SANS}`; x.fillText('Loose leaf · Nine blends · Since last Tuesday', W / 2, H * 0.86); x.textAlign = 'left';
    },
    (x, W, H) => {   // musical
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1030'); g.addColorStop(0.7, '#27306e'); g.addColorStop(1, '#6a3b78'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      const r = rng(5); for (let i = 0; i < 90; i++) { x.fillStyle = `rgba(255,255,240,${0.3 + r() * 0.7})`; x.fillRect(r() * W, r() * H * 0.55, 1.5, 1.5); }
      x.fillStyle = '#ffe9a8'; x.beginPath(); x.arc(W * 0.7, H * 0.2, W * 0.11, 0, 6.3); x.fill(); x.fillStyle = '#0b1030'; x.beginPath(); x.arc(W * 0.74, H * 0.185, W * 0.1, 0, 6.3); x.fill();
      x.fillStyle = '#080a1c'; for (let i = 0; i < 12; i++) { const bw = W * (0.06 + r() * 0.08), bh = H * (0.12 + r() * 0.24); x.fillRect(i * W / 11 - 10, H * 0.78 - bh, bw, bh + H); } x.fillRect(0, H * 0.78, W, H);
      x.strokeStyle = '#080a1c'; x.lineWidth = W * 0.014; x.beginPath(); x.moveTo(W * 0.3, H * 0.78); x.lineTo(W * 0.3, H * 0.42); x.stroke(); x.fillStyle = '#ffd36b'; x.shadowColor = '#ffd36b'; x.shadowBlur = 40; x.beginPath(); x.arc(W * 0.3, H * 0.4, W * 0.035, 0, 6.3); x.fill(); x.shadowBlur = 0;
      x.textAlign = 'center'; x.fillStyle = '#ffe9a8'; x.font = `700 ${H * 0.07}px ${SERIF}`; x.fillText('THE LAST', W / 2, H * 0.855); x.fillText('LAMPLIGHTER', W / 2, H * 0.925); x.font = `500 ${H * 0.026}px ${SANS}`; x.fillStyle = '#d9d4ee'; x.fillText('A new musical · Opens this spring · Halloran Theatre', W / 2, H * 0.965); x.textAlign = 'left';
    },
    (x, W, H) => {   // evening college
      x.fillStyle = '#0e8a83'; x.fillRect(0, 0, W, H); x.fillStyle = '#f7d64a'; x.beginPath(); x.moveTo(0, H * 0.62); x.lineTo(W, H * 0.44); x.lineTo(W, H); x.lineTo(0, H); x.fill();
      x.fillStyle = '#fff'; x.font = `700 ${H * 0.115}px ${SANS}`; x.fillText('Start', W * 0.08, H * 0.2); x.fillText('some', W * 0.08, H * 0.31); x.fillText('where.', W * 0.08, H * 0.42);
      x.fillStyle = '#10302e'; x.font = `700 ${H * 0.042}px ${SANS}`; x.fillText('Hollowbrook', W * 0.08, H * 0.74); x.fillText('Evening College', W * 0.08, H * 0.79); x.font = `500 ${H * 0.027}px ${SANS}`; x.fillText('Classes after work. Forty subjects.', W * 0.08, H * 0.85); x.fillText('Enrolment opens the first of the month.', W * 0.08, H * 0.885);
    },
    (x, W, H) => {   // sparkling water
      const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#dff3fb'); g.addColorStop(1, '#6bb9de'); x.fillStyle = g; x.fillRect(0, 0, W, H); const r = rng(8);
      for (let i = 0; i < 70; i++) { const bx = r() * W, by = r() * H, br = 3 + r() * r() * W * 0.06; x.strokeStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`; x.lineWidth = 2; x.beginPath(); x.arc(bx, by, br, 0, 6.3); x.stroke(); x.fillStyle = 'rgba(255,255,255,0.14)'; x.fill(); }
      x.fillStyle = '#1c6f9c'; rrect(x, W * 0.39, H * 0.3, W * 0.22, H * 0.5, W * 0.06); x.fill(); x.fillRect(W * 0.455, H * 0.2, W * 0.09, H * 0.12); x.fillStyle = '#e9f6fb'; x.fillRect(W * 0.39, H * 0.47, W * 0.22, H * 0.15); x.fillStyle = '#0f4f73'; x.fillRect(W * 0.45, H * 0.185, W * 0.1, H * 0.03);
      x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(W * 0.41, H * 0.32, W * 0.03, H * 0.44);
      x.textAlign = 'center'; x.fillStyle = '#1c6f9c'; x.font = `700 ${H * 0.036}px ${SANS}`; x.fillText('ZEPHRA', W / 2, H * 0.56); x.fillStyle = '#0f4f73'; x.font = `700 ${H * 0.1}px ${SANS}`; x.fillText('ZEPHRA', W / 2, H * 0.13); x.font = `500 ${H * 0.034}px ${SANS}`; x.fillText('sparkling. nothing else.', W / 2, H * 0.9); x.textAlign = 'left';
    },
    (x, W, H) => {   // safety notice
      x.fillStyle = '#f2c318'; x.fillRect(0, 0, W, H); x.fillStyle = '#17181a'; x.font = `700 ${H * 0.15}px ${SANS}`; x.fillText('Look', W * 0.08, H * 0.2); x.fillText('up.', W * 0.08, H * 0.34);
      x.beginPath(); x.arc(W * 0.66, H * 0.5, W * 0.085, 0, 6.3); x.fill(); rrect(x, W * 0.56, H * 0.57, W * 0.2, H * 0.24, W * 0.05); x.fill(); x.fillStyle = '#f2c318'; rrect(x, W * 0.47, H * 0.63, W * 0.1, H * 0.085, W * 0.012); x.fill(); x.strokeStyle = '#17181a'; x.lineWidth = W * 0.012; x.stroke();
      x.fillStyle = '#17181a'; x.fillRect(0, H * 0.81, W, H * 0.012); for (let i = 0; i < 16; i++) { x.beginPath(); x.arc(W * (0.03 + i * 0.0627), H * 0.845, W * 0.012, 0, 6.3); x.fill(); }
      x.font = `600 ${H * 0.032}px ${SANS}`; x.fillText('The platform edge is closer', W * 0.08, H * 0.905); x.fillText('than whatever is on your phone.', W * 0.08, H * 0.945);
    },
  ];
  // POSTER in a frame, about 1.2 x 1.7 m. Returns { material (vertex colours on), map, w, h, kind }.
  function poster(seed = 0) {
    const kind = ((Math.floor(seed) % POSTERS.length) + POSTERS.length) % POSTERS.length, key = 'poster:' + kind; if (cache.has(key)) return cache.get(key);
    const W = 384, H = 544, F = 14, c = mkCanvas(W, H), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#9da1a4'); g.addColorStop(0.5, '#6f7376'); g.addColorStop(1, '#8b8f92'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.strokeStyle = 'rgba(20,20,20,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.save(); ctx.beginPath(); ctx.rect(F, F, W - 2 * F, H - 2 * F); ctx.clip(); ctx.translate(F, F); ctx.textBaseline = 'alphabetic'; POSTERS[kind](ctx, W - 2 * F, H - 2 * F); ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(F, F, W - 2 * F, H - 2 * F);
    const gl = ctx.createLinearGradient(0, 0, W, H * 0.7); gl.addColorStop(0, 'rgba(255,255,255,0.13)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.02)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.09)'); gl.addColorStop(0.62, 'rgba(255,255,255,0)'); ctx.fillStyle = gl; ctx.fillRect(F, F, W - 2 * F, H - 2 * F);   // the glass
    const r = rng(kind + 40); for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(40,36,30,${r() * 0.12})`; const y = H - r() * r() * H; ctx.fillRect(r() * W, y, 1 + r() * 3, 1 + r() * 3); }
    const dg = ctx.createLinearGradient(0, H * 0.75, 0, H); dg.addColorStop(0, 'rgba(40,34,26,0)'); dg.addColorStop(1, 'rgba(40,34,26,0.22)'); ctx.fillStyle = dg; ctx.fillRect(0, 0, W, H);
    const map = texOf(c), out = { material: litMat(map, null), map, w: 1.2, h: 1.7, kind }; cache.set(key, out); return out;
  }

  function dispose() { for (const t of textures) t.dispose(); for (const m of materials) m.dispose(); textures.length = 0; materials.length = 0; cache.clear(); bytes = 0; }
  return { mat, tablet, band, sign, badge, drawBadge, entranceSign, exitSign, poster, dispose, ROUTES, posterKinds: POSTERS.length, stats: () => ({ textures: textures.length, bytes: Math.round(bytes), mb: +(bytes / 1048576).toFixed(1) }) };
}
