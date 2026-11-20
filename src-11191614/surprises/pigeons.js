// surprises/pigeons.js: flocks of street pigeons that burst off a whole block when you run through them, wheel over the street as one flock
// and come back down one by one (surprises lane, Nov 15; Matt's list, item 5).
// What a real flock does, and so this one:
//   - on the ground: loose clusters along a block's sidewalk, each bird walking with the head-bob, pecking, idling; they walk out of a
//     walker's way without fuss;
//   - alarm travels: run at them (or drive at them, or fire a gun) and the nearest go up first, the rest of the block a beat behind, in a wave,
//     with the clatter of wings; a slow walker only makes the bird underfoot flutter a few metres on;
//   - in the air they are one flock: a strung-out bunch that wheels round a loop along the street between the buildings, banking together,
//     flapping with short glides;
//   - they come back singly, each to the block it left: a glide down, a flare with fast braking wingbeats, a hop, wings folded, back to pecking.
//     Not while you still stand where they want to land.
//   ?pigeons=0 off     ?pigeonshare=0.5 share of 96 m squares with a flock     game.surprises.mods.pigeons.info()
// Cost: nothing but a grid lookup unless a flock's square is within 90 m. Awake: 2 draws (the birds, their shadow pass), at most 150 birds
// of 269 triangles, about 0.15 ms of script.
import * as THREE from 'three';
import { clamp, lerp, smooth, TAU, rng } from './kit.js';

const CELL = 96, WAKE = 95, SLEEP = 140, MAXB = 150, KERB = 0.15;
const hsh = (i, j, k) => { let n = (i * 374761393 + j * 668265263 + k * 2246822519) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const wrap = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// ------------------------------------------------------------------------------------------------ the bird
// local frame: +x ahead, +y up, +z to its right; origin on the ground between the feet. aK = [part, side, span from the shoulder, head weight]
// parts: 0 body, 1 spread wing, 2 folded wing, 3 legs, 4 head and neck, 5 tail fan
function birdGeometry() {
  const pos = [], col = [], k4 = [], idx = [];
  const V = (x, y, z, c, part, side = 0, d = 0, w = 0) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); k4.push(part, side, d, w); return pos.length / 3 - 1; };
  const BODY = [0.25, 0.275, 0.33], HEAD = [0.17, 0.19, 0.24], RUMP = [0.42, 0.43, 0.46], DARK = [0.07, 0.07, 0.085], WING = [0.33, 0.35, 0.39], WTOP = [0.2, 0.21, 0.25], GREEN = [0.13, 0.27, 0.23], PURP = [0.27, 0.2, 0.31], BEAK = [0.1, 0.09, 0.09], CERE = [0.8, 0.78, 0.74], LEG = [0.85, 0.36, 0.34], EYE = [0.85, 0.33, 0.04];
  // the body: rings along a spine from tail to beak
  const SEC = [[-0.12, 0.062, 0.01, 0.024, DARK, 0], [-0.08, 0.068, 0.034, 0.042, RUMP, 0], [-0.03, 0.078, 0.055, 0.06, BODY, 0], [0.025, 0.088, 0.062, 0.064, BODY, 0], [0.065, 0.107, 0.054, 0.054, BODY, 0.1], [0.088, 0.135, 0.038, 0.04, PURP, 0.5], [0.097, 0.158, 0.029, 0.03, GREEN, 0.85],
    [0.103, 0.176, 0.025, 0.025, HEAD, 1], [0.114, 0.184, 0.024, 0.0235, HEAD, 1], [0.13, 0.182, 0.015, 0.014, HEAD, 1], [0.14, 0.18, 0.008, 0.0075, CERE, 1], [0.146, 0.178, 0.006, 0.0055, CERE, 1], [0.162, 0.172, 0.0012, 0.0012, BEAK, 1]], NR = 12;
  for (let s = 0; s < SEC.length; s++) { const [x, y, ry, rz, c, w] = SEC[s]; for (let a = 0; a < NR; a++) { const th = (a / NR) * TAU; let cc = c; if (c === PURP && Math.cos(th) < -0.2) cc = BODY; if (c === GREEN && Math.cos(th) < -0.5) cc = PURP;      // the sheen sits on the nape and sides; the breast below is body grey
      V(x, y + ry * Math.cos(th), rz * Math.sin(th), cc, w > 0 ? 4 : 0, 0, 0, w); } }
  for (let s = 0; s + 1 < SEC.length; s++) for (let a = 0; a < NR; a++) { const a1 = (a + 1) % NR, p = s * NR + a, q = s * NR + a1, r = (s + 1) * NR + a, t = (s + 1) * NR + a1; idx.push(p, r, q, q, r, t); }
  // eyes
  for (const sd of [-1, 1]) { const x = 0.119, y = 0.188, z = sd * 0.0238, e = 0.0048, a = V(x - e, y - e, z, EYE, 4, 0, 0, 1), b = V(x + e, y - e, z, EYE, 4, 0, 0, 1), c = V(x + e, y + e, z, EYE, 4, 0, 0, 1), d = V(x - e, y + e, z, EYE, 4, 0, 0, 1); idx.push(a, b, c, a, c, d); }
  // legs: two thin posts and a forward toe
  for (const sd of [-1, 1]) { const z = sd * 0.026, x = -0.005, t = 0.0045, a = V(x - t, 0, z, LEG, 3), b = V(x + t, 0, z, LEG, 3), c = V(x + t, 0.04, z, LEG, 3), d = V(x - t, 0.04, z, LEG, 3), e = V(x, 0, z - t, LEG, 3), f = V(x, 0, z + t, LEG, 3), g2 = V(x, 0.04, z + t, LEG, 3), h = V(x, 0.04, z - t, LEG, 3);
    idx.push(a, b, c, a, c, d, e, f, g2, e, g2, h); for (const ta of [-0.5, 0, 0.5]) { const t0 = V(x - 0.004, 0.003, z - 0.004, LEG, 3), t1 = V(x - 0.004, 0.003, z + 0.004, LEG, 3), t2 = V(x + 0.036 * Math.cos(ta), 0.003, z + 0.036 * Math.sin(ta), LEG, 3); idx.push(t0, t1, t2); } }
  // folded wings: a shell along each flank, pale grey with the two dark bars, the dark tips crossing over the rump
  for (const sd of [-1, 1]) { const NX = 7, NV = 3, base = pos.length / 3;
    for (let i = 0; i < NX; i++) { const u = i / (NX - 1), x = lerp(0.062, -0.15, u); for (let j = 0; j < NV; j++) { const v = j / (NV - 1), hgt = 0.036 * Math.sin(Math.PI * (0.12 + 0.88 * (1 - u * 0.75))) * (1 - 0.35 * u), y = 0.098 - u * 0.012 + (v - 0.5) * 2 * hgt, bulge = Math.sin(Math.PI * v) * 0.012 * (1 - u * 0.6), z = sd * (lerp(0.056, 0.014, u * u) + bulge - Math.abs(v - 0.5) * 0.012);
      const bar = (u > 0.42 && u < 0.5) || (u > 0.62 && u < 0.7); V(x, y, z, u > 0.86 ? DARK : bar && v < 0.8 ? DARK : WING, 2, sd, 0, 0); } }
    for (let i = 0; i + 1 < NX; i++) for (let j = 0; j + 1 < NV; j++) { const p = base + i * NV + j, q = p + 1, r = p + NV, t = r + 1; if (sd > 0) idx.push(p, r, q, q, r, t); else idx.push(p, q, r, q, t, r); } }
  // spread wings: stations out from the shoulder; leading edge, mid chord, trailing edge
  const ST = [[0, 0.05, -0.085], [0.05, 0.062, -0.09], [0.1, 0.07, -0.088], [0.14, 0.068, -0.082], [0.18, 0.058, -0.08], [0.215, 0.044, -0.07], [0.25, 0.026, -0.062], [0.285, 0.004, -0.048], [0.315, -0.02, -0.036], [0.34, -0.046, -0.05]];
  for (const sd of [-1, 1]) { const base = pos.length / 3, NJ = 4;
    for (let i = 0; i < ST.length; i++) { const [d, le, te0] = ST[i], te = te0 - (i % 2 ? 0.012 : 0) * (i > 3 ? 1.6 : 1); for (let j = 0; j < NJ; j++) { const u = j / (NJ - 1), c = lerp(le, te, u), tip = i >= 7, bar = (u > 0.6 && u < 0.72 && i <= 6) || (u > 0.9 && i <= 6);
      V(0.03 + c, 0.112 + Math.sin(u * Math.PI) * 0.008, sd * (0.05 + d * 0.8), tip ? [0.08, 0.085, 0.1] : bar ? DARK : u < 0.34 ? WTOP : WING, 1, sd, d * 0.8, 0); } }
    for (let i = 0; i + 1 < ST.length; i++) for (let j = 0; j + 1 < NJ; j++) { const p = base + i * NJ + j, q = p + 1, r = p + NJ, t = r + 1; if (sd > 0) idx.push(p, q, r, q, t, r); else idx.push(p, r, q, q, r, t); } }
  // tail fan
  { const N = 6, row = (x, y, hw, c) => { const a = []; for (let k = 0; k <= N; k++) a.push(V(x - 0.006 * Math.cos((k / N - 0.5) * 2.2), y, (k / N - 0.5) * 2 * hw, c, 5)); return a; }, r0 = row(-0.09, 0.072, 0.02, RUMP), r1 = row(-0.165, 0.064, 0.03, BODY), r2 = row(-0.2, 0.06, 0.033, DARK), r3 = row(-0.222, 0.058, 0.034, [0.2, 0.21, 0.25]);
    for (const [A, B] of [[r0, r1], [r1, r2], [r2, r3]]) for (let k = 0; k < N; k++) idx.push(A[k], B[k], B[k + 1], A[k], B[k + 1], A[k + 1]); }
  const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(k4, 4)); g.setIndex(idx); g.computeVertexNormals();
  // a wing's normal is up in its own plane; the fan's too
  { const n = g.attributes.normal, K = g.attributes.aK; for (let i = 0; i < n.count; i++) { const p = K.getX(i); if (p === 1 || p === 5) n.setXYZ(i, 0, 1, 0); } }
  return g;
}
const BIRD_GLSL = /* glsl */`
  attribute vec4 aK; attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; varying float vFlat;
  void bird(inout vec3 p, inout vec3 n){
    float part = aK.x, fold = aI2.x;
    if (part > 0.5 && part < 1.5) {
      if (fold > 0.5) { p = vec3(0.02, 0.09, 0.0); }
      else { float side = aK.y, amp = aI1.w, ph = aI1.z; vec3 sh = vec3(0.03, 0.112, side * 0.05);
        float a1 = amp * sin(ph) + 0.1 + 0.22 * amp, a2 = amp * 0.85 * sin(ph - 1.05);
        vec3 r = p - sh; float zl = r.z * side, yl = r.y, o = max(zl - 0.115, 0.0) * (1.0 - 0.42 * amp * max(0.0, cos(ph))), zi = min(zl, 0.115);
        float z2 = zi + o * cos(a2), y2 = yl + o * sin(a2), c1 = cos(a1), s1 = sin(a1);
        p = sh + vec3(r.x - o * 0.25 * amp * max(0.0, cos(ph)), z2 * s1 + y2 * c1, (z2 * c1 - y2 * s1) * side);
        float na = a1 + a2 * step(0.115, zl); n = vec3(0.0, cos(na), -sin(na) * side); }
    } else if (part > 1.5 && part < 3.5) { if (fold < 0.5) p = vec3(0.0, 0.085, 0.0); }
    else if (part > 3.5 && part < 4.5) { p.x += aI2.y * aK.w; }
    else if (part > 4.5) { p.z *= 1.0 + 2.6 * (1.0 - fold); }
    vec3 c = vec3(0.0, 0.085, 0.0); p -= c;
    float cb = cos(aI1.y), sb = sin(aI1.y); p = vec3(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb); n = vec3(n.x, n.y * cb - n.z * sb, n.y * sb + n.z * cb);
    float cp = cos(aI1.x), sp = sin(aI1.x); p = vec3(p.x * cp - p.y * sp, p.x * sp + p.y * cp, p.z); n = vec3(n.x * cp - n.y * sp, n.x * sp + n.y * cp, n.z);
    p += c; float ch = cos(aI0.w), sh2 = sin(aI0.w); p = vec3(p.x * ch + p.z * sh2, p.y, -p.x * sh2 + p.z * ch); n = vec3(n.x * ch + n.z * sh2, n.y, -n.x * sh2 + n.z * ch);
    p += aI0.xyz;
  }`;
function birdMaterials(kit) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + BIRD_GLSL)
    .replace('#include <beginnormal_vertex>', 'vec3 bp = position; vec3 objectNormal = normal; bird(bp, objectNormal); vFlat = (aK.x > 0.5 && aK.x < 1.5) || aK.x > 4.5 ? 1.0 : 0.0;')
    .replace('#include <begin_vertex>', 'vec3 transformed = bp;')
    .replace('#include <color_vertex>', '#include <color_vertex>\n float sd = aI2.w; vec3 tn = sd < 0.28 ? vec3(0.42, 0.42, 0.46) : sd > 0.93 ? vec3(1.6, 1.55, 1.5) : sd > 0.86 ? vec3(1.05, 0.72, 0.6) : vec3(0.8 + 0.3 * fract(sd * 7.3)); vColor.rgb *= tn;'); };
  { const ob = mat.onBeforeCompile; mat.onBeforeCompile = (sh, r) => { ob(sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying float vFlat;').replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n if (vFlat > 0.5) normal = normalize(mix(normal, normalize(vViewPosition), 0.72));'); }; }
  mat.customProgramCacheKey = () => 'sur_pigeon_5';
  if (kit && kit.bakeLit) kit.bakeLit(mat, 'bp');
  const dep = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  dep.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + BIRD_GLSL.replace('varying float vFlat;', '')).replace('#include <begin_vertex>', 'vec3 bp = position; vec3 bn = vec3(0.0, 1.0, 0.0); bird(bp, bn); vec3 transformed = bp;'); };
  dep.customProgramCacheKey = () => 'sur_pigeon_d5';
  return { mat, dep };
}

// ------------------------------------------------------------------------------------------------ the flocks
export function install(game, kit) {
  const g = game, P = g.P, st = g.statics, w = g.world;
  const S = { flocks: [], sites: new Map(), birds: 0, ms: 0, scares: 0, landed: 0, tune: { share: P.has('pigeonshare') ? +P.get('pigeonshare') : 0.5, speed: 9.5, runAt: 3.0 } };
  const _o = {};
  const clear = (x, y, r = 0.35) => st.onSidewalk(x, y) && !st.resolve(x, y, r, _o);
  const inMap = (x, y) => !g.bounds || g.bounds.in(x, y, -12);

  // ---- where a flock lives: one sidewalk spot per map square (or none), found once, with its clusters strung along the block
  function siteOf(i, j) {
    const key = i * 100003 + j; let s = S.sites.get(key); if (s !== undefined) return s; s = null;
    if (hsh(i, j, 1) < S.tune.share) for (let k = 0; k < 14 && !s; k++) {
      const x = (i + 0.1 + 0.8 * hsh(i, j, 10 + k)) * CELL, y = (j + 0.1 + 0.8 * hsh(i, j, 40 + k)) * CELL; if (!inMap(x, y) || !clear(x, y, 0.8)) continue;
      const ne = g.roads.nearestEdge(x, y, 40); if (!ne) continue; let dx = x - ne.x, dy = y - ne.y; const dn = Math.hypot(dx, dy); if (dn < 3.5 || dn > 12 || st.raycast(x, y, ne.x, ne.y) < 1) continue; dx /= dn; dy /= dn;      /* on the street's own sidewalk with the roadway in plain sight: never a court or an alley inside the block */      // (dx, dy): from the street's centre line to the sidewalk
      const ux = -dy, uy = dx, cl = [];      // along the block
      for (const q of [0, 1, -1, 2, -2, 3, -3]) { const r1 = hsh(i, j, 70 + q), r2 = hsh(i, j, 90 + q), cx = x + ux * q * (8 + 3 * r1) + dx * (r2 - 0.5) * 2.4, cy = y + uy * q * (8 + 3 * r1) + dy * (r2 - 0.5) * 2.4; if (clear(cx, cy, 0.6) && st.raycast(cx, cy, ne.x, ne.y) === 1) cl.push([cx, cy]); if (cl.length >= 5) break; }
      if (cl.length < 2) continue;
      // the air over the street here: how wide between the walls, how far along it is open
      const mx = ne.x, my = ne.y, ray = (ax, ay, len) => st.raycast(mx, my, mx + ax * len, my + ay * len) * len, wl = ray(dx, dy, 30), wr = ray(-dx, -dy, 30), fa = ray(ux, uy, 70), fb = ray(-ux, -uy, 70);
      const half = Math.max(3, Math.min(wl, wr, 16) - 2.5), off = 0, la = Math.max(12, Math.min(fa, fb, 34) - 3);
      s = { key, x, y, ux, uy, dx, dy, cl, loop: { x: mx + dx * off, y: my + dy * off, a: la, b: Math.min(half, 9) }, seed: Math.floor(hsh(i, j, 5) * 1e6) };
    }
    S.sites.set(key, s); return s;
  }
  function wake(site) {
    const r = rng(site.seed), F = { site, birds: [], s: r() * TAU, dir: r() < 0.5 ? 1 : -1, air: 0, airT: 0, until: 0, landT: 0, queue: [], coo: 2 + r() * 6, h: 9 + r() * 4 };
    const per = Math.min(16, Math.floor((MAXB / 2) / site.cl.length));
    for (const c of site.cl) { const n = Math.round(per * (0.55 + 0.45 * r())); for (let k = 0; k < n; k++) { const a = r() * TAU, d = r() * r() * 2.1 + 0.08, x = c[0] + Math.cos(a) * d, y = c[1] + Math.sin(a) * d; if (!clear(x, y, 0.2)) continue;
      F.birds.push({ x, y, h: KERB, hx: x, hy: y, hd: r() * TAU, pitch: 0, bank: 0, ph: r() * TAU, amp: 0, fold: 1, bob: 0, seed: r(), st: 0, t: r() * 3, gs: 0, tx: x, ty: y, n: 0, vx: 0, vy: 0, vh: 0, lag: (r() - 0.5) * 1.1, off: (r() - 0.5) * 2, dh: (r() - 0.5) * 3, glide: 0, delay: -1, wallT: r() * 0.3, stride: 0, f: 0 }); } }
    S.flocks.push(F); return F;
  }
  // states: 0 on the ground, 1 taking off, 2 with the flock, 3 coming in to land, 4 a short flutter to a new spot
  const GROUND = 0, UP = 1, FLY = 2, LAND = 3, HOP = 4;
  function scare(F, b, fx, fy, delay) { if (b.st !== GROUND || b.delay >= 0) return; b.delay = delay; b.fx = fx; b.fy = fy; }
  function alarm(F, x, y, radius, first = 0) { let n = 0; for (const b of F.birds) { if (b.st !== GROUND || b.delay >= 0) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < radius) { scare(F, b, x, y, first + d / 26 + Math.random() * 0.16); n++; } } if (n) { S.scares++; F.wave = { x, y, t: 0 }; } return n; }
  function liftoff(F, b) {
    b.st = UP; b.t = 0; b.delay = -1; b.fold = 0; b.amp = 1.15; let ax = b.x - b.fx, ay = b.y - b.fy; const d = Math.hypot(ax, ay) || 1; ax /= d; ay /= d;
    // up and away from what scared it, turning toward the open street
    const sx = -F.site.dx, sy = -F.site.dy, m = 0.9 + Math.random() * 0.3, ex = ax * m + sx * 0.75 + (Math.random() - 0.5) * 0.35, ey = ay * m + sy * 0.75 + (Math.random() - 0.5) * 0.35, e = Math.hypot(ex, ey) || 1;
    b.vx = (ex / e) * 4.2; b.vy = (ey / e) * 4.2; b.vh = 5.2 + Math.random() * 1.6; b.hd = Math.atan2(b.vy, b.vx);
    if (!F.air) { F.airT = 0; F.until = 9 + Math.random() * 6; F.queue.length = 0; } F.air++;
    // every bird that goes up spreads the alarm to those beside it: the wave down the block
    for (const o of F.birds) if (o.st === GROUND && o.delay < 0) { const dd = Math.hypot(o.x - b.x, o.y - b.y); if (dd < 14) scare(F, o, b.fx, b.fy, dd / 26 + 0.04 + Math.random() * 0.16); }
    clatter(F, b);
  }
  // somewhere to come down: its own spot unless the player (or a car) is standing on it, then a spot by another cluster
  function threatAt(x, y, r) { for (const q of threats) if (Math.hypot(q.x - x, q.y - y) < r + q.r) return true; return false; }
  function newHome(F, b) { for (let k = 0; k < 8; k++) { const c = F.site.cl[Math.floor(Math.random() * F.site.cl.length)], a = Math.random() * TAU, d = Math.sqrt(Math.random()) * 2, x = c[0] + Math.cos(a) * d, y = c[1] + Math.sin(a) * d; if (clear(x, y, 0.2) && !threatAt(x, y, 4)) { b.hx = x; b.hy = y; return true; } } return false; }

  // ---- sound: the clatter of a flock going up (rendered once into a buffer: dozens of wing claps at 9 to 11 a second each), single wingbeats, a coo
  let voice = null, clatBuf = null, lastClat = -9;
  function mkClatter(a) { const sr = a.sampleRate, n = Math.floor(sr * 2.6), buf = a.createBuffer(1, n, sr), d = buf.getChannelData(0); let s = 987654321; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let bird = 0; bird < 34; bird++) { const t0 = rnd() * rnd() * 1.1, rate = 9 + rnd() * 3, beats = 6 + Math.floor(rnd() * 10), lvl = 0.35 + rnd() * 0.65; for (let k = 0; k < beats; k++) { const at = Math.floor((t0 + k / rate + (rnd() - 0.5) * 0.012) * sr), len = Math.floor(sr * (0.012 + rnd() * 0.012)), fall = Math.exp(-k * 0.16) * lvl; let lp = 0;
      for (let i = 0; i < len && at + i < n; i++) { const e = Math.exp(-i / (len * 0.28)), x = rnd() * 2 - 1; lp += (x - lp) * 0.55; d[at + i] += (x - lp * 0.6) * e * fall * 0.22; } } }
    return buf; }
  function ensureVoice() { if (voice) return voice; const s = kit.audio(); if (!s) return null; voice = kit.voice({ ref: 7, max: 90, level: 1 }); if (voice && !clatBuf) clatBuf = mkClatter(s.ac); return voice; }
  function clatter(F, b) { const v = ensureVoice(); if (!v) return; const now = v.a.currentTime; F.snd = { x: b.x, y: b.y };
    if (F.air >= 3 && now - lastClat > 0.9) { lastClat = now; const src = v.a.createBufferSource(); src.buffer = clatBuf; src.playbackRate.value = 0.94 + Math.random() * 0.12; const f = v.a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2300; f.Q.value = 0.45; const gn = v.a.createGain(); gn.gain.value = 0.9; src.connect(f); f.connect(gn); gn.connect(v.in); src.start(now, Math.random() * 0.05); }
    else if (F.air < 3) for (let k = 0; k < 6; k++) kit.burst(v, { freq: 2100 + Math.random() * 700, q: 0.6, gain: 0.2 * Math.exp(-k * 0.15), att: 0.002, dec: 0.022, at: k * 0.1 + Math.random() * 0.01 }); }
  function flutter(F, b) { const v = ensureVoice(); if (!v || Math.hypot(b.x - cam.x, b.y - cam.y) > 25) return; F.snd = { x: b.x, y: b.y }; for (let k = 0; k < 4; k++) kit.burst(v, { freq: 2000 + Math.random() * 600, q: 0.6, gain: 0.1, att: 0.002, dec: 0.02, at: k * 0.095 }); }
  function coo(F) { const v = ensureVoice(); if (!v) return; const a = v.a, t = a.currentTime, o = a.createOscillator(), o2 = a.createOscillator(), e = a.createGain(), lp = a.createBiquadFilter(), trem = a.createOscillator(), tg = a.createGain(); o.type = 'sine'; o2.type = 'triangle'; lp.type = 'lowpass'; lp.frequency.value = 900;
    const f0 = 300 + Math.random() * 50; for (const [dt2, f] of [[0, f0], [0.16, f0 * 1.22], [0.42, f0 * 1.3], [0.62, f0 * 0.98], [0.95, f0 * 0.9]]) { o.frequency.linearRampToValueAtTime(f, t + dt2); o2.frequency.linearRampToValueAtTime(f * 2, t + dt2); }
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.09, t + 0.1); e.gain.linearRampToValueAtTime(0.03, t + 0.3); e.gain.linearRampToValueAtTime(0.11, t + 0.48); e.gain.linearRampToValueAtTime(0, t + 1.0);
    trem.frequency.value = 23; tg.gain.value = 0.035; trem.connect(tg); tg.connect(e.gain); const g2 = a.createGain(); g2.gain.value = 0.25; o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(e); e.connect(v.in); o.start(t); o2.start(t); trem.start(t); o.stop(t + 1.05); o2.stop(t + 1.05); trem.stop(t + 1.05); }

  // ---- drawing: one instanced mesh for every bird awake
  let mesh = null, blob = null, I0 = null, I1 = null, I2 = null;
  function mkMesh() { const geo = birdGeometry(), { mat, dep } = birdMaterials(kit); I0 = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4); I1 = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4); I2 = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 4), 4);
    for (const a of [I0, I1, I2]) a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aI0', I0); geo.setAttribute('aI1', I1); geo.setAttribute('aI2', I2); geo.instanceCount = 0;
    mesh = new THREE.Mesh(geo, mat); mesh.customDepthMaterial = dep; mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.name = 'sur_pigeons'; mesh.userData.tris = geo.index.count / 3; w.scene.add(mesh);
    const bg = new THREE.InstancedBufferGeometry(), pl0 = new THREE.PlaneGeometry(1, 1); pl0.rotateX(-Math.PI / 2); bg.index = pl0.index; bg.setAttribute('position', pl0.attributes.position); bg.setAttribute('uv', pl0.attributes.uv); bg.setAttribute('aI0', I0); bg.instanceCount = 0;
    blob = new THREE.Mesh(bg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexShader: 'attribute vec4 aI0; varying vec2 vU; varying float vA; void main(){ vU = uv * 2.0 - 1.0; float up = max(aI0.y - 0.15, 0.0); vA = 0.5 * (1.0 - smoothstep(0.0, 1.6, up)); float s = 0.26 + up * 0.25; float c = cos(aI0.w), sn = sin(aI0.w); vec3 p = vec3(position.x * s * 1.25, 0.0, position.z * s); p = vec3(p.x * c + p.z * sn, 0.0, -p.x * sn + p.z * c); gl_Position = projectionMatrix * viewMatrix * vec4(p.x + aI0.x, 0.158, p.z + aI0.z, 1.0); }', fragmentShader: 'varying vec2 vU; varying float vA; void main(){ float r = length(vU); float a = vA * (1.0 - smoothstep(0.2, 1.0, r)); if (a < 0.004) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }' }));
    blob.frustumCulled = false; blob.matrixAutoUpdate = false; blob.renderOrder = 4; blob.name = 'sur_pigeon_shadow'; w.scene.add(blob); }

  // ---- one bird, one frame
  const threats = []; let cam = { x: 0, y: 0 }, bang = 0;
  function ground(F, b, dt) {
    if (b.delay >= 0) { b.delay -= dt; b.pitch += (0.25 - b.pitch) * Math.min(1, dt * 14); b.bob = 0.012; if (b.delay < 0) { liftoff(F, b); return; } return; }      // head up: it has seen it
    // who is close: a runner or a car sets the block off; a walker is walked away from; a foot about to land on it makes it flutter on
    for (const q of threats) { const dx = b.x - q.x, dy = b.y - q.y, d = Math.hypot(dx, dy) - q.r; if (d > 7.5) continue;
      const closing = d > 0.01 ? -(dx * q.vx + dy * q.vy) / (d + q.r) : q.sp, reach = q.sp > S.tune.runAt ? (q.car ? Math.min(3.2, 1 + 0.2 * q.sp) : 2.2 + 1.05 * q.sp) : 0;      // a runner is seen coming from well off; traffic passing in the road is nothing to a pigeon unless it comes at them
      if (q.sp > S.tune.runAt && d < reach && closing > q.sp * 0.25) { alarm(F, q.x, q.y, 9); scare(F, b, q.x, q.y, Math.random() * 0.08); return; }
      if (d < 0.55) { if (q.sp > 0.3 && newHome(F, b)) { b.st = HOP; b.t = 0; b.fold = 0; b.amp = 1.1; const e = Math.hypot(dx, dy) || 1; b.vx = (dx / e) * 2.4; b.vy = (dy / e) * 2.4; b.vh = 2.3; F.air++; flutter(F, b); return; } }
      if (d < 2.3 && b.gs !== 3) { const e = Math.hypot(dx, dy) || 1, tx = b.x + (dx / e) * 1.5 + (Math.random() - 0.5), ty = b.y + (dy / e) * 1.5 + (Math.random() - 0.5); if (clear(tx, ty, 0.15)) { b.gs = 3; b.tx = tx; b.ty = ty; b.t = 1.6; } } }
    b.t -= dt;
    if (b.gs === 1 || b.gs === 3) {      // walking (3: out of someone's way, quicker)
      const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy), sp = b.gs === 3 ? 0.75 : 0.24;
      if (d < 0.05 || b.t <= 0) { b.gs = 0; b.t = 0.2 + Math.random() * 1.2; }
      else { b.hd += wrap(Math.atan2(dy, dx) - b.hd) * Math.min(1, dt * 7); const k = Math.max(0, Math.cos(wrap(Math.atan2(dy, dx) - b.hd))); b.x += Math.cos(b.hd) * sp * k * dt; b.y += Math.sin(b.hd) * sp * k * dt; b.stride += sp * k * dt / 0.062;
        const fr = b.stride % 1; b.bob = 0.014 - 0.03 * fr * fr; }      // the head holds still in the air while the body walks under it, then darts ahead
      b.pitch += (0 - b.pitch) * Math.min(1, dt * 10);
    } else if (b.gs === 2) {      // pecking: down, a jab or two, up
      const u = b.t, cyc = 0.34, k = Math.max(0, Math.sin((u / cyc) * Math.PI)); b.pitch += (-0.2 - 0.72 * Math.abs(k) - b.pitch) * Math.min(1, dt * 22); b.bob = 0.01 * k; if (b.t <= 0) { if (--b.n > 0) b.t = cyc; else { b.gs = 0; b.t = 0.25 + Math.random() * 0.9; } }
    } else {      // idle; then choose
      b.pitch += (0 - b.pitch) * Math.min(1, dt * 9); b.bob += (0 - b.bob) * Math.min(1, dt * 8);
      if (b.t <= 0) { const r = Math.random(); if (r < 0.62) { b.gs = 2; b.n = 2 + Math.floor(Math.random() * 4); b.t = 0.34; } else if (r < 0.9) { const a = Math.random() * TAU, d = 0.2 + Math.random() * 0.8, tx = b.hx + Math.cos(a) * d, ty = b.hy + Math.sin(a) * d; if (clear(tx, ty, 0.15)) { b.gs = 1; b.tx = tx; b.ty = ty; b.t = 6; } else b.t = 0.3; } else { b.hd += (Math.random() - 0.5) * 1.6; b.t = 0.4 + Math.random() * 1.6; } }
    }
    for (const o of F.birds) { if (o === b || o.st !== GROUND) continue; const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy; if (d2 < 0.0484 && d2 > 1e-6) { const d = Math.sqrt(d2), k = (0.22 - d) * 0.5 / d; b.x += dx * k; b.y += dy * k; } }
    b.h = KERB; b.bank = 0; b.amp = 0; b.fold = 1;
  }
  function steer(b, tx, ty, th, speed, acc, dt) {
    const dx = tx - b.x, dy = ty - b.y, dh = th - b.h, d = Math.hypot(dx, dy, dh) || 1, wx = (dx / d) * speed, wy = (dy / d) * speed, wh = (dh / d) * speed, ax = wx - b.vx, ay = wy - b.vy, ah = wh - b.vh, a = Math.hypot(ax, ay, ah) || 1, k = Math.min(1, (acc * dt) / a);
    b.vx += ax * k; b.vy += ay * k; b.vh += ah * k; }
  function fly(F, b, dt) {
    b.t += dt; const L = F.site.loop, s = F.site, hd0 = b.hd;
    if (b.st === UP) { // the first second: straight up and out, wings at full stretch
      b.vh += (5.4 - b.vh) * Math.min(1, dt * 2.5); const sp = Math.hypot(b.vx, b.vy) || 1, want = 6.5; b.vx *= 1 + (want / sp - 1) * Math.min(1, dt * 1.6); b.vy *= 1 + (want / sp - 1) * Math.min(1, dt * 1.6);
      b.amp = 1.15; b.f = 10.5; if (b.t > 0.9 + b.seed * 0.5) { b.st = FLY; b.t = 0; } }
    else if (b.st === FLY) { // a place in the flock: a point on the loop along the street, ahead of or behind the flock's own
      const a = F.s + b.lag * 0.75, ca = Math.cos(a), sa = Math.sin(a), lx = ca * L.a, ly = sa * (L.b + b.off * 0.5), tx = L.x + s.ux * lx + s.dx * ly, ty = L.y + s.uy * lx + s.dy * ly, th = F.h + b.dh * 0.6 + 1.6 * Math.sin(a * 2 + b.seed * 6);
      // aim a little ahead along the loop so the bird flies the curve instead of chasing a point
      const la = a + F.dir * 0.35, ax2 = L.x + s.ux * Math.cos(la) * L.a + s.dx * Math.sin(la) * (L.b + b.off * 0.5), ay2 = L.y + s.uy * Math.cos(la) * L.a + s.dy * Math.sin(la) * (L.b + b.off * 0.5), far = Math.hypot(tx - b.x, ty - b.y);
      steer(b, far > 6 ? tx : ax2, far > 6 ? ty : ay2, th, S.tune.speed * (far > 6 ? 1.12 : 1) * (0.94 + 0.12 * b.seed), 13, dt);
      b.glide -= dt; if (b.glide < -1.2 - b.seed * 2 && b.vh < 0.4) b.glide = 0.22 + Math.random() * 0.3; b.amp += ((b.glide > 0 ? 0.12 : 0.82) - b.amp) * Math.min(1, dt * 12); b.f = 7.2 + b.seed; }
    else { // coming down: a glide to above its spot, then the flare
      const dx = b.hx - b.x, dy = b.hy - b.y, d = Math.hypot(dx, dy), hop = b.st === HOP;
      if (d > 2.2 && !hop) { steer(b, b.hx, b.hy, KERB + 0.9 + Math.min(6, d * 0.32), clamp(2.5 + d * 0.55, 3, 9), 12, dt); b.amp += ((d > 9 ? 0.2 : 0.7) - b.amp) * Math.min(1, dt * 8); b.f = 7.5; }
      else { const th = KERB + (hop ? Math.min(0.5, d * 0.35) : Math.min(0.9, d * 0.45)) - 0.02; steer(b, b.hx, b.hy, th, clamp(0.7 + d * 1.5, 0.7, 3.4), 16, dt); b.amp += (1.15 - b.amp) * Math.min(1, dt * 12); b.f = 11;
        if (d < 0.22 && b.h < KERB + 0.12) { b.st = GROUND; b.gs = 0; b.t = 0.3 + Math.random(); b.h = KERB; b.fold = 1; b.amp = 0; b.pitch = 0.15; b.bank = 0; b.vx = b.vy = b.vh = 0; F.air--; S.landed++; return; } }
      if (!hop && b.t > 1 && d < 6 && threatAt(b.hx, b.hy, 3) && (!newHome(F, b))) { b.st = FLY; b.t = 0; F.queue.push(b); } }      // someone is standing there: round again
    // walls: a bird about to fly into one turns back toward the middle of the street
    b.wallT -= dt; if (b.wallT <= 0 && b.h < 30) { b.wallT = 0.12; if (st.raycast(b.x, b.y, b.x + b.vx * 0.55, b.y + b.vy * 0.55) < 1) { const cx = L.x - b.x, cy = L.y - b.y, cd = Math.hypot(cx, cy) || 1, sp = Math.hypot(b.vx, b.vy); b.vx = b.vx * 0.35 + (cx / cd) * sp * 0.65; b.vy = b.vy * 0.35 + (cy / cd) * sp * 0.65; b.vh += 1.5; } }
    b.x += b.vx * dt; b.y += b.vy * dt; b.h = Math.max(KERB, b.h + b.vh * dt);
    const hs = Math.hypot(b.vx, b.vy); if (hs > 0.3) b.hd = Math.atan2(b.vy, b.vx); const turn = wrap(b.hd - hd0) / Math.max(dt, 1e-3);
    b.bank += (clamp(-turn * 0.5, -1.1, 1.1) - b.bank) * Math.min(1, dt * 6);
    const flare = (b.st === LAND || b.st === HOP) && Math.hypot(b.hx - b.x, b.hy - b.y) < 2.4 ? 0.75 : b.st === UP ? 0.55 : 0;
    b.pitch += (clamp(Math.atan2(b.vh, Math.max(hs, 1)) * 0.7 + flare, -0.7, 1.1) - b.pitch) * Math.min(1, dt * 8);
    b.ph += b.f * TAU * dt; b.fold = 0; b.bob = 0;
  }

  // ---- every frame
  let lastShots = 0, checkT = 0;
  kit.onFrame((dt, t) => {
    const t0 = performance.now(); cam = kit.cam(); const pl = g.player;
    checkT -= dt; if (checkT <= 0) { checkT = 0.5;
      const ci = Math.floor(pl.x / CELL), cj = Math.floor(pl.y / CELL);
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const s = siteOf(i, j); if (!s || S.flocks.some((F) => F.site === s)) continue; if (Math.hypot(s.x - pl.x, s.y - pl.y) < WAKE && S.flocks.length < 2) wake(s); }
      for (let k = S.flocks.length - 1; k >= 0; k--) { const F = S.flocks[k]; if (Math.hypot(F.site.x - pl.x, F.site.y - pl.y) > SLEEP && Math.hypot(F.site.x - cam.x, F.site.y - cam.y) > SLEEP) S.flocks.splice(k, 1); }
      S.birds = S.flocks.reduce((n, F) => n + F.birds.length, 0); }
    if (!S.flocks.length) { if (mesh && mesh.visible) { mesh.visible = false; if (blob) blob.visible = false; } return; }
    if (!mesh) mkMesh();
    if (dt > 0) {
      // what a pigeon minds: the player on foot or at the wheel, traffic near the flock, a gunshot
      threats.length = 0; if (pl.vehicle) { const v = pl.vehicle; threats.push({ x: v.x, y: v.y, vx: v.vx, vy: v.vy, sp: Math.hypot(v.vx, v.vy), r: 1.3, car: true }); }
      else if (!(g.heli && g.heli.piloted)) threats.push({ x: pl.x, y: pl.y, vx: Math.cos(pl.h) * (pl.speed || 0), vy: Math.sin(pl.h) * (pl.speed || 0), sp: pl.speed || 0, r: 0.3 });
      for (const F of S.flocks) for (const c of g.traffic.cars) { if (Math.abs(c.x - F.site.x) > 40 || Math.abs(c.y - F.site.y) > 40 || threats.length > 10) continue; threats.push({ x: c.x, y: c.y, vx: Math.cos(c.h) * c.v, vy: Math.sin(c.h) * c.v, sp: Math.abs(c.v), r: 1.3, car: true }); }
      const shots = g.combat && typeof g.combat.shots === 'number' ? g.combat.shots : 0; if (shots !== lastShots) { lastShots = shots; for (const F of S.flocks) if (Math.hypot(F.site.x - pl.x, F.site.y - pl.y) < 70) alarm(F, pl.x, pl.y, 80, Math.hypot(F.site.x - pl.x, F.site.y - pl.y) / 340); }
      for (const F of S.flocks) {
        if (F.air > 0) { F.airT += dt; F.s += F.dir * (S.tune.speed / Math.max(8, (F.site.loop.a + F.site.loop.b) * 0.5)) * dt;
          // down again, one at a time, once it has been quiet where they live
          if (F.airT > F.until) { F.landT -= dt; if (F.landT <= 0) { if (!F.queue.length) for (const b of F.birds) if (b.st === FLY) F.queue.splice(Math.floor(Math.random() * (F.queue.length + 1)), 0, b);
              const quiet = !threats.some((q) => q.sp > S.tune.runAt && Math.hypot(q.x - F.site.x, q.y - F.site.y) < 22) || F.airT > F.until + 30, b = quiet ? F.queue.shift() : null;
              if (b && b.st === FLY) { if (threatAt(b.hx, b.hy, 3.5)) newHome(F, b); b.st = LAND; b.t = 0; } F.landT = 0.25 + Math.random() * Math.random() * 1.6; } } }
        else { F.coo -= dt; if (F.coo <= 0) { F.coo = 5 + Math.random() * 9; if (Math.hypot(F.site.x - cam.x, F.site.y - cam.y) < 14) { F.snd = { x: F.site.x, y: F.site.y }; coo(F); } } }
        for (const b of F.birds) { if (b.st === GROUND) ground(F, b, dt); else fly(F, b, dt); }
        if (voice && F.snd) voice.at(F.snd.x, F.snd.y, 1.5, dt);
      }
    }
    let n = 0; const A0 = I0.array, A1 = I1.array, A2 = I2.array;
    for (const F of S.flocks) for (const b of F.birds) { if (n >= MAXB) break; const o = n * 4; A0[o] = b.x; A0[o + 1] = b.h; A0[o + 2] = -b.y; A0[o + 3] = b.hd; A1[o] = b.pitch; A1[o + 1] = b.bank; A1[o + 2] = b.ph % TAU; A1[o + 3] = b.amp; A2[o] = b.fold; A2[o + 1] = b.bob; A2[o + 2] = 0; A2[o + 3] = b.seed; n++; }
    mesh.geometry.instanceCount = n; mesh.visible = n > 0; if (blob) { blob.geometry.instanceCount = n; blob.visible = n > 0; } for (const a of [I0, I1, I2]) { a.clearUpdateRanges && a.clearUpdateRanges(); a.addUpdateRange && a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    S.ms = S.ms * 0.95 + (performance.now() - t0) * 0.05;
  }, 'pigeons');

  S.states = () => S.flocks.map((F) => { const c = [0, 0, 0, 0, 0]; let mh = 0; for (const b of F.birds) { c[b.st]++; mh = Math.max(mh, b.h); } return c.join('/') + ' top ' + mh.toFixed(1); }).join(' | ');
  S.info = () => ({ flocks: S.flocks.length, birds: S.birds, air: S.flocks.map((F) => F.air), sites: [...S.sites.values()].filter(Boolean).length, scares: S.scares, landed: S.landed, ms: +S.ms.toFixed(3), tris: mesh ? mesh.userData.tris : 0 });
  S.siteNear = (x, y, reach = 4) => { let best = null, bd = 1e9; const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL); for (let i = ci - reach; i <= ci + reach; i++) for (let j = cj - reach; j <= cj + reach; j++) { const s = siteOf(i, j); if (!s) continue; const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } } return best; };
  S.alarm = alarm; S.wake = (s) => S.flocks.find((F) => F.site === s) || wake(s);
  return S;
}

// stand the player at the end of the nearest flock's block, facing down it (run through it to set it off)
export function show(game, kit, S) {
  const pl = game.player, s = S.siteNear(pl.x, pl.y); if (!s) return false;
  const a = s.cl[s.cl.length - 1], far = s.cl.reduce((m, c) => (Math.hypot(c[0] - a[0], c[1] - a[1]) > Math.hypot(m[0] - a[0], m[1] - a[1]) ? c : m), a), d = Math.hypot(a[0] - far[0], a[1] - far[1]) || 1, ux = (a[0] - far[0]) / d, uy = (a[1] - far[1]) / d, o = {};
  game.statics.resolve(a[0] + ux * 9, a[1] + uy * 9, 0.34, o); pl.x = o.x; pl.y = o.y; pl.h = Math.atan2(-uy, -ux);
  if (pl.vehicle) { pl.vehicle = null; pl.vis.object.visible = true; game.cam.mode = 'foot'; } game.focus.x = pl.x; game.focus.y = pl.y; game.cam.yaw = pl.h; game.snapCamera(); S.wake(s); return s;
}
