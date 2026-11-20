// trees_gen.js: seeded tree generator for the streets lane (part: trees). Pure JS, no three.js: also runs in node for previews.
// A tree = wood (tapered tubes: trunk, limbs, twigs) + leaves (one small mesh per leaf, set on the twigs). Units metres, Y up, base at origin.
// makeTree(spec, seed) -> { wood: {pos, nrm, uv, col, idx, cuts[4]}, leaves: [ {pos, nrm, col, idx} x4 LOD ], info }

export function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// leaf outlines in the leaf's own frame: x across, y along the midrib (0 = base, 1 = tip), fan triangles from vertex 0.
// 'fold' lifts the edges (a V along the midrib), 'tip' drops the apex.
const LEAF = {
  // London plane: broad, three pointed lobes (4 triangles)
  plane: { v: [[0, 0], [0.56, 0.30], [0.20, 0.52], [0, 1.0], [-0.20, 0.52], [-0.56, 0.30]], f: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]], w: 1.0 },
  // callery pear / elm: ovate with a drawn-out tip (4 triangles)
  ovate: { v: [[0, 0], [0.30, 0.22], [0.27, 0.58], [0, 1.0], [-0.27, 0.58], [-0.30, 0.22]], f: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]], w: 1.0 },
  // honey locust: a pinnate frond, separate small leaflets either side of a rachis (6 triangles with gaps between them)
  frond: { v: [[0.02, 0.05], [0.26, 0.14], [0.03, 0.24], [-0.02, 0.20], [-0.27, 0.30], [-0.03, 0.40], [0.02, 0.38], [0.25, 0.50], [0.03, 0.58], [-0.02, 0.54], [-0.24, 0.66], [-0.03, 0.74], [0.02, 0.72], [0.20, 0.84], [0.02, 0.90], [-0.02, 0.86], [-0.15, 0.97], [0.0, 1.0]],
    f: [[0, 1, 2], [3, 5, 4], [6, 7, 8], [9, 11, 10], [12, 13, 14], [15, 17, 16]], w: 1.0 },
  // near band: five-lobed plane leaf (8 triangles) and a rounder ovate leaf (6 triangles)
  plane5: { v: [[0, 0], [0.50, 0.10], [0.30, 0.26], [0.56, 0.62], [0.17, 0.62], [0, 1.0], [-0.17, 0.62], [-0.56, 0.62], [-0.30, 0.26], [-0.50, 0.10]],
    f: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 6], [0, 6, 7], [0, 7, 8], [0, 8, 9]], w: 1.0 },
  ovate8: { v: [[0, 0], [0.21, 0.10], [0.31, 0.36], [0.24, 0.66], [0, 1.0], [-0.24, 0.66], [-0.31, 0.36], [-0.21, 0.10]],
    f: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 6], [0, 6, 7]], w: 1.0 },
  // far bands: a plain kite (2 triangles)
  kite: { v: [[0, 0], [0.42, 0.42], [0, 1.0], [-0.42, 0.42]], f: [[0, 1, 2], [0, 2, 3]], w: 1.0 },
  kitef: { v: [[0, 0], [0.26, 0.45], [0, 1.0], [-0.26, 0.45]], f: [[0, 1, 2], [0, 2, 3]], w: 1.0 },
};

export const SPECIES = {
  // London plane, street size: clear mottled trunk, a few big ascending limbs, broad open crown
  plane: { H: 13.6, crownR: 3.9, forkH: [3.6, 4.6], trunkR: 0.25, scaff: [3, 4], scaffAng: [0.42, 0.78], leader: 0.75, len1: 0.29, ratio: 0.76, split: [0.38, 0.70], up: 0.10, droop: 0.10, wander: 0.20,
    levels: 6, leaf: 'plane5', mid: 'plane', far: 'kite', leafSize: 0.185, leaves: 9800, spread: 0.30, bark: 0, lateral: 0.7 },
  // big park plane
  planeBig: { H: 15.5, crownR: 6.0, forkH: [3.8, 5.2], trunkR: 0.34, scaff: [4, 5], scaffAng: [0.5, 0.95], leader: 0.6, len1: 0.30, ratio: 0.77, split: [0.42, 0.78], up: 0.06, droop: 0.16, wander: 0.22,
    levels: 6, leaf: 'plane', mid: 'plane', far: 'kite', leafSize: 0.232, leaves: 9500, spread: 0.34, bark: 0, lateral: 0.8 },
  // honey locust: vase shape, zig-zag limbs, thin airy crown of fine fronds, flat-topped
  locust: { H: 11.0, crownR: 4.0, forkH: [2.6, 3.4], trunkR: 0.165, scaff: [3, 4], scaffAng: [0.50, 0.85], leader: 0.0, len1: 0.34, ratio: 0.79, split: [0.45, 0.85], up: 0.10, droop: 0.05, wander: 0.34,
    levels: 6, leaf: 'frond', mid: 'kitef', far: 'kitef', leafSize: 0.229, leaves: 9100, spread: 0.26, bark: 1, lateral: 0.5 },
  // callery pear: low fork, many steep limbs, dense upright egg-shaped crown of small glossy leaves
  pear: { H: 8.8, crownR: 2.3, forkH: [1.9, 2.5], trunkR: 0.165, scaff: [5, 6], scaffAng: [0.22, 0.48], leader: 1.0, len1: 0.27, ratio: 0.77, split: [0.24, 0.46], up: 0.22, droop: 0.0, wander: 0.14,
    levels: 6, leaf: 'ovate8', mid: 'ovate', far: 'kitef', leafSize: 0.108, leaves: 12400, spread: 0.20, bark: 2, lateral: 0.9 },
  // park elm / oak: broad spreading crown wider than tall, drooping tips
  broad: { H: 13.0, crownR: 6.8, forkH: [3.0, 4.0], trunkR: 0.30, scaff: [4, 5], scaffAng: [0.65, 1.05], leader: 0.3, len1: 0.33, ratio: 0.77, split: [0.45, 0.80], up: 0.08, droop: 0.22, wander: 0.24,
    levels: 6, leaf: 'ovate', mid: 'ovate', far: 'kitef', leafSize: 0.160, leaves: 9000, spread: 0.30, bark: 2, lateral: 0.8 },
};

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  perp: (a) => V.norm(Math.abs(a[1]) < 0.9 ? V.cross(a, [0, 1, 0]) : V.cross(a, [1, 0, 0])),
};
// rotate v about unit axis k by angle
function rot(v, k, ang) { const c = Math.cos(ang), s = Math.sin(ang), d = V.dot(k, v), x = V.cross(k, v); return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)]; }

export function makeTree(S, seed) {
  const R = rng(seed), rr = (a, b) => a + (b - a) * R();
  const branches = [];      // { pts: [[x,y,z]...], rad: [...], lvl }
  const twigs = [];         // leaf-bearing: { pts, rad }
  const forkH = rr(S.forkH[0], S.forkH[1]), crownH = S.H - forkH;
  const L1 = crownH * S.len1;

  function grow(p, d, len, r, lvl, r1mul) {
    const segs = lvl === 0 ? 6 : lvl <= 2 ? 5 : lvl <= 4 ? 3 : 2, pts = [p], rad = [r];
    const rEnd = r * (r1mul || (lvl === 0 ? 0.74 : 0.62));
    let q = p, dir = d;
    for (let i = 1; i <= segs; i++) {
      const w = S.wander * (lvl === 0 ? 0.5 : 1), outer = lvl / S.levels;
      dir = V.norm([dir[0] + (R() - 0.5) * 2 * w, dir[1] + (R() - 0.5) * 2 * w * 0.7 + S.up * (1 - outer) - S.droop * outer * outer * 1.6, dir[2] + (R() - 0.5) * 2 * w]);
      if (lvl > 0) {   // keep the crown inside the species' envelope: turn back in and down near its edge
        const rho = Math.hypot(q[0], q[2]) / S.crownR, hy = q[1] / S.H;
        if (rho > 0.7) { const k = (rho - 0.7) * 2.6 / (Math.hypot(q[0], q[2]) + 1e-6); dir = V.norm([dir[0] - q[0] * k, dir[1] + (rho - 0.7) * 0.5, dir[2] - q[2] * k]); }
        if (hy > 0.86) dir = V.norm([dir[0], dir[1] - (hy - 0.86) * 7, dir[2]]);
        if (rho > 1.05 || hy > 1.0) len *= 0.8;
      }
      q = V.add(q, V.mul(dir, len / segs)); pts.push(q); rad.push(r + (rEnd - r) * (i / segs));
    }
    branches.push({ pts, rad, lvl });
    const ends = lvl >= S.levels || rEnd < 0.004;
    if (lvl >= S.levels - 1 || ends) twigs.push({ pts, rad, lvl: ends ? S.levels : lvl });
    if (ends) return;
    // laterals along the branch
    if (lvl >= 1) {
      const nl = 1 + (R() < S.lateral ? 1 : 0) + (lvl <= 2 && R() < S.lateral * 0.5 ? 1 : 0);
      for (let k = 0; k < nl; k++) {
        const t = rr(0.3, 0.85), i0 = Math.min(segs - 1, Math.floor(t * segs)), f = t * segs - i0;
        const bp = V.add(V.mul(pts[i0], 1 - f), V.mul(pts[i0 + 1], f)), bd = V.norm(V.sub(pts[i0 + 1], pts[i0])), br = rad[i0] + (rad[i0 + 1] - rad[i0]) * f;
        const ax = rot(V.perp(bd), bd, R() * 6.283), cd = rot(bd, ax, rr(0.7, 1.15));
        grow(bp, cd, len * rr(0.5, 0.72), br * rr(0.38, 0.5), Math.min(S.levels, lvl + (R() < 0.5 ? 2 : 1)));
      }
    }
    // the fork at the end
    const n = lvl === 0 ? Math.round(rr(S.scaff[0], S.scaff[1])) : (R() < 0.3 ? 3 : 2);
    const shares = []; let sum = 0; for (let i = 0; i < n; i++) { const s = rr(0.6, 1.4) * (i === 0 ? 1.5 : 1); shares.push(s); sum += s; }
    const az0 = R() * 6.283;
    for (let i = 0; i < n; i++) {
      const share = shares[i] / sum, cr = rEnd * Math.pow(share, 0.42) * 0.98;
      const lo = lvl === 0 ? S.scaffAng[0] : S.split[0], hi = lvl === 0 ? S.scaffAng[1] : S.split[1];
      let ang = rr(lo, hi) * (i === 0 && lvl > 0 ? 0.55 : 1);
      if (lvl === 0 && i === 0 && S.leader > 0) ang *= (1 - S.leader * 0.85);
      const ax = rot(V.perp(dir), dir, az0 + (i / n) * 6.283 + rr(-0.5, 0.5));
      const cd = rot(dir, ax, ang);
      grow(q, cd, (lvl === 0 ? L1 : len * S.ratio) * rr(0.82, 1.18) * (lvl === 0 && i === 0 && S.leader > 0 ? 1.15 : 1), cr, lvl + 1);
    }
  }
  const lean = [rr(-0.09, 0.09), 1, rr(-0.09, 0.09)];
  grow([0, -0.35, 0], V.norm(lean), forkH + 0.35, S.trunkR, 0, 0.74);
  // ---- leaves on the twigs
  const LP = [];   // per leaf: base p, axis a, normal n, size, hue rand
  let twigLen = 0; for (const t of twigs) for (let i = 1; i < t.pts.length; i++) twigLen += V.len(V.sub(t.pts[i], t.pts[i - 1])) * (t.lvl === S.levels ? 1 : 0.55);
  const perM = S.leaves / twigLen;
  for (const t of twigs) {
    const wgt = t.lvl === S.levels ? 1 : 0.55;
    for (let i = 1; i < t.pts.length; i++) {
      const a = t.pts[i - 1], b = t.pts[i], d = V.sub(b, a), l = V.len(d), dn = V.norm(d);
      let n = l * perM * wgt; n = Math.floor(n) + (R() < n % 1 ? 1 : 0);
      // leaves come in sprays: short side shoots off the twig, several leaves on each
      let k = 0; const tipSeg = i === t.pts.length - 1 && t.lvl === S.levels; if (tipSeg) n = Math.max(n, 4);
      while (k < n) {
        const m = Math.min(n - k, 3 + Math.floor(R() * 5));
        const f = tipSeg && k === 0 ? 0.97 : R(), sp = V.add(a, V.mul(d, f)); k += m;
        const out = rot(V.perp(dn), dn, R() * 6.283), sd = V.norm([out[0] + dn[0] * 0.6, out[1] + dn[1] * 0.6 - 0.25, out[2] + dn[2] * 0.6]);
        const sl = S.spread * rr(0.4, 1.3);
        for (let j = 0; j < m; j++) {
          const u = (j + 0.5) / m, base = V.add(sp, V.mul(sd, sl * u)), side = rot(V.perp(sd), sd, R() * 6.283);
          let ax = V.norm([sd[0] * 0.5 + side[0] + (R() - 0.5) * 0.6, sd[1] * 0.5 + side[1] * 0.5 - 0.35 + (R() - 0.5) * 0.5, sd[2] * 0.5 + side[2] + (R() - 0.5) * 0.6]);
          // blade faces the sky, tilted at random
          let nn = V.norm([(R() - 0.5) * 1.3, 1, (R() - 0.5) * 1.3]); nn = V.norm(V.sub(nn, V.mul(ax, V.dot(nn, ax))));
          LP.push({ p: base, a: ax, n: nn, s: S.leafSize * rr(0.7, 1.25), h: R(), g: R() });
        }
      }
    }
  }
  // crown box and a density grid for self-occlusion (how deep inside the crown a leaf sits)
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const L of LP) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], L.p[k]); hi[k] = Math.max(hi[k], L.p[k]); }
  const cs = 0.5, gx = Math.ceil((hi[0] - lo[0]) / cs) + 2, gy = Math.ceil((hi[1] - lo[1]) / cs) + 2, gz = Math.ceil((hi[2] - lo[2]) / cs) + 2;
  const grid = new Float32Array(gx * gy * gz);
  const gi = (p) => { const x = Math.floor((p[0] - lo[0]) / cs) + 1, y = Math.floor((p[1] - lo[1]) / cs) + 1, z = Math.floor((p[2] - lo[2]) / cs) + 1; return (x < 0 || y < 0 || z < 0 || x >= gx || y >= gy || z >= gz) ? -1 : (z * gy + y) * gx + x; };
  for (const L of LP) { const i = gi(L.p); if (i >= 0) grid[i] += L.s * L.s; }
  const dirs = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0.95, 0.3, 0], [-0.95, 0.3, 0], [0, 0.3, 0.95], [0, 0.3, -0.95]];
  const occl = (p) => { let vis = 0; for (const d of dirs) { let s = 0; for (let k = 1; k < 16; k++) { const i = gi([p[0] + d[0] * cs * k, p[1] + d[1] * cs * k, p[2] + d[2] * cs * k]); if (i < 0) break; s += grid[i]; } vis += Math.exp(-s * 1.7); } return vis / dirs.length; };
  const cc = [(lo[0] + hi[0]) / 2, lo[1] + (hi[1] - lo[1]) * 0.42, (lo[2] + hi[2]) / 2], ce = [(hi[0] - lo[0]) / 2 + 0.01, (hi[1] - lo[1]) / 2 + 0.01, (hi[2] - lo[2]) / 2 + 0.01];
  for (const L of LP) {
    L.ao = Math.min(1, 0.04 + 1.15 * occl(L.p));
    L.cn = V.norm([(L.p[0] - cc[0]) / (ce[0] * ce[0]), (L.p[1] - cc[1]) / (ce[1] * ce[1]), (L.p[2] - cc[2]) / (ce[2] * ce[2])]);
  }
  // shuffle so any prefix is an even sample of the crown
  for (let i = LP.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const t = LP[i]; LP[i] = LP[j]; LP[j] = t; }

  function leafMesh(count, scale, shapeName) {
    const sh = LEAF[shapeName], nv = sh.v.length, n = Math.min(count, LP.length);
    const pos = new Float32Array(n * nv * 3), nrm = new Int8Array(n * nv * 4), col = new Uint8Array(n * nv * 4), idx = new Uint32Array(n * sh.f.length * 3);
    for (let i = 0; i < n; i++) {
      const L = LP[i], s = L.s * scale, x = V.cross(L.a, L.n);
      // shading normal: the leaf's own, turned to the outside of the crown, mixed with the crown's
      const sgn = V.dot(L.n, L.cn) < -0.2 ? -1 : 1;
      const fold = 0.28 + 0.3 * L.g, tip = 0.12 + 0.3 * L.h;
      // colour: brightness and a share of yellowing leaves (r = brightness, g = yellowing, b = occlusion, a = spare)
      const yel = L.h > 0.90 ? 0.6 + 0.4 * L.g : L.h > 0.72 ? 0.25 * L.g : 0.0;
      for (let k = 0; k < nv; k++) {
        const u = sh.v[k][0], v = sh.v[k][1], z = Math.abs(u) * fold - v * v * tip;
        const o = (i * nv + k) * 3;
        pos[o] = L.p[0] + (x[0] * u + L.a[0] * v + L.n[0] * z) * s; pos[o + 1] = L.p[1] + (x[1] * u + L.a[1] * v + L.n[1] * z) * s; pos[o + 2] = L.p[2] + (x[2] * u + L.a[2] * v + L.n[2] * z) * s;
        // per-vertex leaf normal: tilted by the fold
        const lx = -Math.sign(u) * fold * 0.8, ln = V.norm([L.n[0] + x[0] * lx + L.a[0] * v * tip, L.n[1] + x[1] * lx + L.a[1] * v * tip, L.n[2] + x[2] * lx + L.a[2] * v * tip]);
        const bn = V.norm([ln[0] * sgn * 0.75 + L.cn[0] * 0.6, ln[1] * sgn * 0.75 + L.cn[1] * 0.6, ln[2] * sgn * 0.75 + L.cn[2] * 0.6]);
        const q = (i * nv + k) * 4;
        nrm[q] = Math.round(bn[0] * 127); nrm[q + 1] = Math.round(bn[1] * 127); nrm[q + 2] = Math.round(bn[2] * 127); nrm[q + 3] = 0;
        col[q] = Math.round(255 * (0.55 + 0.45 * L.g)); col[q + 1] = Math.round(255 * yel); col[q + 2] = Math.round(255 * L.ao); col[q + 3] = Math.round(255 * Math.min(1, Math.abs(u) / 0.26));
      }
      for (let f = 0; f < sh.f.length; f++) { const o = (i * sh.f.length + f) * 3; idx[o] = i * nv + sh.f[f][0]; idx[o + 1] = i * nv + sh.f[f][1]; idx[o + 2] = i * nv + sh.f[f][2]; }
    }
    return { pos, nrm, col, idx, leaves: n };
  }
  const N = LP.length;
  const leaves = [leafMesh(N, 1.0, S.leaf), leafMesh(Math.round(N / 2.5), 1.66, S.mid || S.leaf), leafMesh(Math.round(N / 5), 2.4, S.far), leafMesh(Math.round(N / 11), 3.7, S.far)];

  // ---- wood: tubes, thick first, so a prefix of the index buffer is a coarser tree
  const trunk = branches.find((b) => b.lvl === 0), trunkPath = { pts: trunk.pts.map((q) => q.slice()), rad: trunk.rad.slice() };
  branches.sort((a, b) => b.rad[0] - a.rad[0]);
  const flare = 0.26 + 0.03 * (seed % 4); let rMin = 1e9, rMinY = -1;
  const wp = [], wn = [], wu = [], wc = [], wi = []; const cutR = [0, 0.011, 0.028, 0.06], cuts = [0, 0, 0, 0];
  let done = [false, false, false, false];
  for (const B of branches) {
    for (let k = 1; k < 4; k++) if (!done[k] && B.rad[0] < cutR[k]) { cuts[k] = wi.length; done[k] = true; }
    if (B.lvl === 0) {   // rings every ~12 cm over the first metre so the flare has shape
      const np = [], nr = [];
      for (let i = 0; i < B.pts.length - 1; i++) {
        const a = B.pts[i], b = B.pts[i + 1], n = a[1] < 1.0 ? 6 : 1;
        for (let k = 0; k < n; k++) { const f = k / n; np.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); nr.push(B.rad[i] + (B.rad[i + 1] - B.rad[i]) * f); }
      }
      np.push(B.pts[B.pts.length - 1]); nr.push(B.rad[B.rad.length - 1]); B.pts = np; B.rad = nr;
    }
    const r0 = B.rad[0], sides = B.lvl === 0 ? 24 : r0 > 0.1 ? 10 : r0 > 0.04 ? 6 : r0 > 0.014 ? 4 : 3;
    const base = wp.length / 3; let nprev = null, vlen = 0;
    const urep = Math.max(1, Math.round(6.283 * r0 / 0.45));
    for (let i = 0; i < B.pts.length; i++) {
      const p = B.pts[i], t = V.norm(V.sub(B.pts[Math.min(i + 1, B.pts.length - 1)], B.pts[Math.max(i - 1, 0)]));
      let nx = nprev ? V.norm(V.sub(nprev, V.mul(t, V.dot(nprev, t)))) : V.perp(t); nprev = nx; const bx = V.cross(t, nx);
      if (i > 0) vlen += V.len(V.sub(p, B.pts[i - 1]));
      let r = B.rad[i];
      // (no flare here: a scanned root collar is stood around the base of the trunk in trees.js)
      const ao = B.lvl === 0 ? 1 : Math.min(1, 0.25 + occl(p));
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * 6.283, c = Math.cos(a), s = Math.sin(a);
        // buttress ribs at the very base of the trunk
        // one or two low buttress ridges that are part of the trunk's own surface, and a lopsided swelling; all of it sinks under the soil
        const hh = Math.max(0, p[1]), wr = (d) => { d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.exp(-d * d / 0.1); };
        // lopsided: the foot swells to one side and along one or two buttress ridges, not as a bell
        const rib = B.lvl === 0 ? 1 + 0.03 * Math.sin(a * 5 + p[1] * 6 + seed) + 0.02 * Math.sin(a * 9 - p[1] * 11 + seed * 2) : B.lvl === 1 ? 1 + 0.04 * Math.sin(a * 3 + vlen * 5 + seed) : 1;
        if (B.lvl === 0 && p[1] >= 0.04 && (rMinY < 0 || rMinY === i)) { rMinY = i; rMin = Math.min(rMin, r * rib); }
        const n = [nx[0] * c + bx[0] * s, nx[1] * c + bx[1] * s, nx[2] * c + bx[2] * s];
        wp.push(p[0] + n[0] * r * rib, p[1] + n[1] * r * rib, p[2] + n[2] * r * rib); wn.push(n[0], n[1], n[2]); wu.push((j / sides) * urep, vlen / 0.55);
        wc.push(Math.round(255 * ao), Math.round(255 * Math.min(1, r0 / 0.12)), 0, 255);
      }
    }
    for (let i = 0; i < B.pts.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = a + sides + 1;
      wi.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  for (let k = 1; k < 4; k++) if (!done[k]) cuts[k] = wi.length;
  const wood = { pos: new Float32Array(wp), nrm: new Float32Array(wn), uv: new Float32Array(wu), col: new Uint8Array(wc), idx: new Uint32Array(wi), cuts: [wi.length, cuts[1], cuts[2], cuts[3]] };
  return { wood, leaves, info: { flare, rMin, trunk: trunkPath, lo, hi, forkH, leaves: N, branches: branches.length, woodTris: wi.length / 3, radius: Math.max(hi[0], -lo[0], hi[2], -lo[2]) } };
}
