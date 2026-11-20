// boats.js: the four boats of the water lane, built in code (no model files, no image files).
//   makeBoat(kind, opts) -> { object, spec, parts }      kinds: speedboat, ferry, tug, tour
// Model frame: +X bow, +Y up, +Z starboard, metres; origin on the centreline, midway along the waterline, y = 0 at the design waterline.
// Our own designs and invented names; nothing here is a real make, operator or logo. No per-frame code in this module.
import * as THREE from 'three';

export const KINDS = ['speedboat', 'ferry', 'tug', 'tour'];

// ---------------------------------------------------------------- small maths
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sm = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const M = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(V(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ')), V(sx, sy, sz));
const MIRROR = new THREE.Matrix4().makeScale(1, 1, -1);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- geometry kit: collect pieces per material, merge to one mesh each
class Kit {
  constructor(sideMap = null) { this.b = new Map(); this.sideMap = sideMap; }
  // uv: null keeps the piece's own uv (or zeros); 'xz' = planar from above (decks); +1 / -1 = side-texture half (starboard / port)
  add(key, geo, color = 0xffffff, m = null, uv = null) {
    if (m) geo.applyMatrix4(m);
    const flip = m ? m.determinant() < 0 : false;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    let L = this.b.get(key); if (!L) this.b.set(key, L = []);
    L.push({ geo, color: new THREE.Color(color), flip, uv });
    return this;
  }
  mir(key, geo, color, m = null, uv = null) {          // the piece and its mirror image across the centreline
    const g2 = geo.clone();
    this.add(key, geo, color, m, uv);
    this.add(key, g2, color, m ? MIRROR.clone().multiply(m) : MIRROR.clone(), uv === 1 ? -1 : uv);
    return this;
  }
  side(geo, m = null) { return this.mir('hull', geo, 0xffffff, m, 1); }   // side-textured, both sides
  tris(key) { let n = 0; for (const { geo } of this.b.get(key) || []) n += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; return n; }
  mesh(key, material, name, cast = true, receive = true) {
    const L = this.b.get(key); if (!L) return null;
    let nv = 0, ni = 0;
    for (const { geo } of L) { nv += geo.attributes.position.count; ni += geo.index ? geo.index.count : geo.attributes.position.count; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), C = new Float32Array(nv * 3);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0; const sm_ = this.sideMap;
    for (const { geo, color, flip, uv } of L) {
      const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv, c = p.count;
      P.set(p.array.subarray(0, c * 3), vo * 3); N.set(n.array.subarray(0, c * 3), vo * 3);
      for (let i = 0; i < c; i++) {
        C[(vo + i) * 3] = color.r; C[(vo + i) * 3 + 1] = color.g; C[(vo + i) * 3 + 2] = color.b;
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (uv === 'xz') { U[(vo + i) * 2] = x; U[(vo + i) * 2 + 1] = z; }
        else if (uv === 1 || uv === -1) {
          const fx = (x - sm_.x0) / (sm_.x1 - sm_.x0), fy = (y - sm_.y0) / (sm_.y1 - sm_.y0);
          U[(vo + i) * 2] = uv === 1 ? fx : 1 - fx; U[(vo + i) * 2 + 1] = (uv === 1 ? 0.5 : 0) + fy * 0.5;
        } else if (u) { U[(vo + i) * 2] = u.getX(i); U[(vo + i) * 2 + 1] = u.getY(i); }
      }
      const idx = geo.index;
      const cnt = idx ? idx.count : c;
      for (let i = 0; i < cnt; i += 3) {
        const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, d = idx ? idx.getX(i + 2) : i + 2;
        I[io++] = vo + a; I[io++] = vo + (flip ? d : b); I[io++] = vo + (flip ? b : d);
      }
      vo += c; geo.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
    const me = new THREE.Mesh(g, material); me.name = name; me.castShadow = cast; me.receiveShadow = receive;
    return me;
  }
}

// a surface swept over t (along) and s (across): fn(t, s, outVector3). Normal = d/dt x d/ds.
function loft(fn, nt, ns, t0 = 0, t1 = 1, flip = false) {
  const pos = new Float32Array((nt + 1) * (ns + 1) * 3), v = V(); let k = 0;
  for (let i = 0; i <= nt; i++) for (let j = 0; j <= ns; j++) { fn(t0 + (t1 - t0) * i / nt, j / ns, v); pos[k++] = v.x; pos[k++] = v.y; pos[k++] = v.z; }
  const idx = [];
  for (let i = 0; i < nt; i++) for (let j = 0; j < ns; j++) {
    const a = i * (ns + 1) + j, b = a + ns + 1, c = a + 1, d = b + 1;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// flat-shaded polygon fan from a list of Vector3 (convex-ish, given counter-clockwise seen from the side the normal points to)
function fan(pts) {
  const pos = []; for (const p of pts) pos.push(p.x, p.y, p.z);
  const idx = []; for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const quad = (a, b, c, d) => fan([a, b, c, d]);
// a strip between two polylines of equal length (lower[i] -> upper[i]); normal = (lower[i+1]-lower[i]) x (upper[i]-lower[i])
function strip(lower, upper, smooth = false) {
  const pos = [], idx = [];
  if (smooth) {
    for (let i = 0; i < lower.length; i++) pos.push(lower[i].x, lower[i].y, lower[i].z, upper[i].x, upper[i].y, upper[i].z);
    for (let i = 0; i < lower.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
  } else {
    for (let i = 0; i < lower.length - 1; i++) {
      const a = pos.length / 3;
      for (const p of [lower[i], lower[i + 1], upper[i], upper[i + 1]]) pos.push(p.x, p.y, p.z);
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// box with rounded edges (x length, y height, z width)
function rbox(w, h, d, r, taper = null) {
  const S = 6, g = new THREE.BoxGeometry(w, h, d, S, S, S).toNonIndexed(), p = g.attributes.position, n = g.attributes.normal;
  r = Math.min(r, w / 2, h / 2, d / 2);
  const remap = (c, half) => { const k = Math.round((c / half) * 3), a = Math.abs(k), s = Math.sign(k); return s * [0, half - r, half - r * 0.5, half][a]; };
  const q = V(), inner = V();
  for (let i = 0; i < p.count; i++) {
    q.set(remap(p.getX(i), w / 2), remap(p.getY(i), h / 2), remap(p.getZ(i), d / 2));
    inner.set(clamp(q.x, -w / 2 + r, w / 2 - r), clamp(q.y, -h / 2 + r, h / 2 - r), clamp(q.z, -d / 2 + r, d / 2 - r));
    q.sub(inner); if (q.lengthSq() > 1e-12) { q.normalize(); n.setXYZ(i, q.x, q.y, q.z); }
    else q.set(n.getX(i), n.getY(i), n.getZ(i));
    inner.addScaledVector(q, r);
    if (taper) taper(inner);
    p.setXYZ(i, inner.x, inner.y, inner.z);
  }
  if (taper) g.computeVertexNormals();
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, seg = 12, open = false) => new THREE.CylinderGeometry(r1, r2, h, seg, 1, open);   // r1 = top
// a round bar between two points
function rod(a, b, r, seg = 6, open = false) {
  const d = b.clone().sub(a), len = d.length(), g = new THREE.CylinderGeometry(r, r, len, seg, 1, open);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
  return g;
}
// a tube through points
function tube(pts, r, seg = 6, closed = false, per = 4) {
  const c = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  return new THREE.TubeGeometry(c, Math.max(2, (pts.length - (closed ? 0 : 1)) * per), r, seg, closed);
}

// ---------------------------------------------------------------- textures made in code
const texCache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function finishTex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
// A side-projection paint texture: the upper half is the starboard side, the lower half the port side (mirrored so lettering reads).
// paint(P): P.x(x), P.y(y) give pixels in the current half; P.band(yLow, yHigh, css); P.text(str, x, y, heightMetres, font, css, opts); P.ctx
function sideTexture(key, W, Hh, map, paint, roughPaint = null) {
  if (texCache.has(key)) return texCache.get(key);
  const mk = (fn, w, hh) => {
    const c = canvas(w, hh * 2), ctx = c.getContext('2d');
    for (const side of [1, -1]) {
      ctx.save(); ctx.translate(0, side === 1 ? 0 : hh); ctx.beginPath(); ctx.rect(0, 0, w, hh); ctx.clip();
      const sx = w / (map.x1 - map.x0), sy = hh / (map.y1 - map.y0);
      const P = {
        ctx, side, sx, sy, w, hh,
        x: (x) => { const f = (x - map.x0) * sx; return side === 1 ? f : w - f; },
        y: (y) => hh - (y - map.y0) * sy,
        band(y0, y1, css) { ctx.fillStyle = css; ctx.fillRect(0, P.y(y1), w, P.y(y0) - P.y(y1)); },
        rect(x0, x1, y0, y1, css) { ctx.fillStyle = css; const a = P.x(x0), b = P.x(x1); ctx.fillRect(Math.min(a, b), P.y(y1), Math.abs(b - a), P.y(y0) - P.y(y1)); },
        line(pts, widthM, css) { ctx.strokeStyle = css; ctx.lineWidth = widthM * sy; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(P.x(x), P.y(y)) : ctx.moveTo(P.x(x), P.y(y))); ctx.stroke(); },
        poly(pts, css) { ctx.fillStyle = css; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(P.x(x), P.y(y)) : ctx.moveTo(P.x(x), P.y(y))); ctx.closePath(); ctx.fill(); },
        text(str, x, y, hM, font, css, o = {}) {
          ctx.save(); ctx.translate(P.x(x), P.y(y)); ctx.scale((sx / sy) * (o.stretch || 1), 1);
          if (o.skew) ctx.transform(1, 0, -o.skew, 1, 0, 0);
          ctx.font = font.replace('%', Math.round(hM * sy * 1.38)); ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'alphabetic';
          if (o.spacing && 'letterSpacing' in ctx) ctx.letterSpacing = o.spacing + 'px';
          if (o.shadow) { ctx.fillStyle = o.shadow; ctx.fillText(str, hM * sy * 0.06, hM * sy * 0.06); }
          if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = hM * sy * 0.14; ctx.lineJoin = 'round'; ctx.strokeText(str, 0, 0); }
          ctx.fillStyle = css; ctx.fillText(str, 0, 0); ctx.restore();
        },
      };
      fn(P); ctx.restore();
    }
    return c;
  };
  const out = { map: finishTex(mk(paint, W, Hh)), rough: roughPaint ? finishTex(mk(roughPaint, 64, 256), false) : null };
  texCache.set(key, out); return out;
}
const css = (hex) => '#' + new THREE.Color(hex).getHexString();
const grey = (v) => { const k = Math.round(v * 255); return `rgb(${k},${k},${k})`; };

function teakTexture() {
  if (texCache.has('teak')) return texCache.get('teak');
  const c = canvas(1024, 512), g = c.getContext('2d'), r = rng(7), planks = 8, ph = 512 / planks;
  for (let i = 0; i < planks; i++) {
    const off = Math.floor(r() * 1024);
    for (let seg = 0; seg < 2; seg++) {                       // two boards per row, staggered butt joints
      const tone = 0.86 + r() * 0.26, x0 = (off + seg * 512) % 1024;
      g.fillStyle = `rgb(${Math.round(148 * tone)},${Math.round(101 * tone)},${Math.round(58 * tone)})`;
      g.fillRect(x0, i * ph, 512, ph); if (x0 + 512 > 1024) g.fillRect(x0 - 1024, i * ph, 512, ph);
    }
    for (let k = 0; k < 46; k++) {                            // grain
      const y = i * ph + 3 + r() * (ph - 6), x = r() * 1024, len = 60 + r() * 260;
      g.strokeStyle = r() < 0.5 ? `rgba(70,42,20,${0.06 + r() * 0.12})` : `rgba(205,160,105,${0.05 + r() * 0.1})`; g.lineWidth = 0.6 + r() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 3, x + len * 0.7, y + (r() - 0.5) * 3, x + len, y + (r() - 0.5) * 2); g.stroke();
      if (x + len > 1024) { g.beginPath(); g.moveTo(x - 1024, y); g.lineTo(x - 1024 + len, y); g.stroke(); }
    }
    g.fillStyle = '#17130f'; g.fillRect(0, i * ph - 2, 1024, 4.5);                       // caulking
    for (let seg = 0; seg < 2; seg++) g.fillRect((off + seg * 512) % 1024 - 1.5, i * ph, 3.5, ph);
  }
  g.fillRect(0, 510, 1024, 2);
  const t = finishTex(c, true, true); t.repeat.set(1 / 2.4, 1 / 0.6);   // 8 planks of 7.5 cm across 0.6 m, boards 1.2 m long
  texCache.set('teak', t); return t;
}

// ---------------------------------------------------------------- materials
function paints() {
  return {
    gel: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12, name: 'boat_gelcoat' }),
    soft: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, name: 'boat_soft' }),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05, name: 'boat_paint' }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.16, metalness: 1, name: 'boat_stainless' }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x2c4650, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6, name: 'boat_glass' }),
    teak: new THREE.MeshStandardMaterial({ map: teakTexture(), roughness: 0.72, metalness: 0, name: 'boat_teak' }),
  };
}
const lamp = (color, name) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.35), emissive: color, emissiveIntensity: 0.25, roughness: 0.3, name });
const windowMat = () => new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.08, metalness: 0.2, emissive: 0xffd9a0, emissiveIntensity: 0, envMapIntensity: 1.4, name: 'boat_windows' });

// ================================================================ SPEEDBOAT  "Knot Guilty", a Gowanus 28 (both invented)
function speedboat(opts) {
  const hullColor = opts.color ?? 0x12284e;
  const L = 8.6, X0 = -3.72;                                   // X0 = transom; chosen so the waterline is centred on the origin
  const SOLE = 0.22, TA = 0.07, TW = 0.56, CW = 0.2;           // cockpit sole height, aft wall, windshield bulkhead, coaming width
  const u_ = (t) => clamp((t - 0.3) / 0.7, 0, 1);
  const xs = (t) => X0 + L * t, xk = (t) => X0 + L * t - 0.75 * t ** 5, xc = (t) => X0 + L * t - 0.42 * t ** 5;
  const zs = (t) => (1.3 - 0.07 * (1 - sm(0, 0.3, t))) * (1 - u_(t) ** 2.4);          // sheer half-beam
  const zc = (t) => (1.12 - 0.05 * (1 - sm(0, 0.3, t))) * (1 - u_(t) ** 2.2);         // chine half-beam
  const yk = (t) => -0.47 + 0.72 * clamp((t - 0.5) / 0.5, 0, 1) ** 2.6;               // keel
  const yc = (t) => -0.07 + 0.72 * t ** 2.2;                                           // chine
  const ys = (t) => 0.8 + 0.47 * t ** 1.35;                                            // sheer
  const crown = (t) => lerp(0.2, 0.03, sm(TW, 1, t)) * Math.sqrt(zs(t) / 1.2 + 1e-6);
  const tOfX = (x) => clamp((x - X0) / L, 0, 1);
  const deckY = (x, z) => { const t = tOfX(x); if (t < TW) return ys(t); const b = zs(t) + 1e-6; return ys(t) + crown(t) * (1 - clamp(z / b, -1, 1) ** 2); };
  const XB = xs(TW), XA = xs(TA);

  // section knots, keel -> chine: bottom panels broken by two spray rails, a chine flat, then the topsides
  const F1 = 0.36, F2 = 0.69;
  function knots(t) {
    const wch = 0.07 * (1 - sm(0.6, 0.95, t)), ws = 0.05 * (1 - sm(0.5, 0.82, t));
    const K = V(xk(t), yk(t), 0), C = V(xc(t), yc(t), Math.max(0, zc(t) - wch));
    const B = (f) => K.clone().lerp(C, f), df = C.z > 1e-4 ? ws / C.z : 0;
    const a1 = B(F1), b1 = a1.clone(); b1.z += ws; const a2 = B(F2), b2 = a2.clone(); b2.z += ws;
    return [K, a1, b1, B(Math.min(1, F1 + df)), a2, b2, B(Math.min(1, F2 + df)), C, V(xc(t), yc(t) - 0.012 * (wch / 0.07), zc(t))];
  }
  const sheerP = (t) => V(xs(t), ys(t), zs(t));
  const kit = new Kit({ x0: X0 - 0.08, x1: X0 + L + 0.08, y0: -0.6, y1: 1.34 });
  const NT = 72;
  const seg = [3, 1, 1, 3, 1, 1, 3, 1];
  for (let j = 0; j < 8; j++) kit.side(loft((t, s, o) => { const k = knots(t); o.lerpVectors(k[j], k[j + 1], s); }, NT, seg[j]));
  kit.side(loft((t, s, o) => {                                  // topsides with bow flare
    const c = knots(t)[8], sh = sheerP(t), e = 1 + 1.5 * sm(0.3, 1, t);
    o.set(lerp(c.x, sh.x, s), lerp(c.y, sh.y, s), c.z + (sh.z - c.z) * s ** e);
  }, NT, 10));
  { const k = knots(0), sh = sheerP(0); kit.side(fan([V(X0, 0.3, 0), V(X0, ys(0), 0), sh, ...k.slice().reverse()])); }   // transom

  // ---- deck moulding (white gelcoat)
  const WHITE = 0xe7e8ea, zin = (t) => zs(t) - CW;
  kit.mir('deck', loft((t, s, o) => o.set(xs(t), ys(t) + 0.004, lerp(zs(t), zin(t), s)), 24, 1, TA, TW), WHITE);              // side decks
  kit.mir('deck', loft((t, s, o) => o.set(xs(t), lerp(ys(t) + 0.004, SOLE, s), zin(t) - 0.03 * s), 24, 1, TA, TW), WHITE);    // cockpit sides
  kit.mir('teak', loft((t, s, o) => o.set(xs(t), SOLE, lerp(zin(t) - 0.03, 0, s)), 6, 1, TA, TW), 0xffffff, null, 'xz');     // cockpit sole
  kit.mir('deck', loft((t, s, o) => o.set(xs(t), ys(t) + 0.004, lerp(zs(t), 0, s)), 3, 1, 0, TA), WHITE);                    // aft deck
  kit.mir('deck', loft((t, s, o) => { const b = zs(t); o.set(xs(t), ys(t) + 0.004 + crown(t) * (1 - (1 - s) ** 2), b * (1 - s)); }, 30, 10, TW, 1), WHITE);   // foredeck
  {                                                             // windshield bulkhead (faces aft) and aft cockpit wall (faces forward)
    const zi = zin(TW) - 0.03, b = zs(TW), lo = [], up = [];
    const zl = [-b, -zi - 1e-4, -zi, ...Array.from({ length: 13 }, (_, i) => -zi + (2 * zi) * (i + 1) / 14), zi, zi + 1e-4, b];
    for (const z of zl) { lo.push(V(XB, Math.abs(z) <= zi ? SOLE : ys(TW), z)); up.push(V(XB, ys(TW) + 0.004 + crown(TW) * (1 - (z / b) ** 2), z)); }
    kit.add('deck', strip(lo, up), WHITE);
    const za = zin(TA) - 0.03;
    kit.add('deck', quad(V(XA, SOLE, za), V(XA, SOLE, -za), V(XA, ys(TA) + 0.004, -za), V(XA, ys(TA) + 0.004, za)), WHITE);
  }
  // rub rail (stainless) along the sheer
  kit.mir('chrome', loft((t, s, o) => { const a = (s - 0.5) * Math.PI; o.set(xs(t) + 0.03 * sm(0.97, 1, t), ys(t) - 0.03 + 0.036 * Math.sin(a), zs(t) - 0.004 + 0.034 * Math.cos(a)); }, 60, 4));
  kit.add('chrome', rod(V(X0 - 0.012, ys(0) - 0.03, -zs(0)), V(X0 - 0.012, ys(0) - 0.03, zs(0)), 0.034, 8));

  // ---- engine bracket and swim platform
  kit.add('deck', rbox(0.62, 0.5, 1.5, 0.07, (p) => { if (p.y < 0) { const k = 1 + p.y * 0.9; p.z *= k; p.x = 0.31 - (0.31 - p.x) * (1 + p.y * 0.7); } }), WHITE, M(X0 - 0.3, 0.1, 0));
  kit.add('deck', rbox(0.72, 0.06, 2.3, 0.028), WHITE, M(X0 - 0.35, 0.36, 0));
  kit.add('teak', quad(V(X0 - 0.66, 0.392, 1.1), V(X0 - 0.02, 0.392, 1.1), V(X0 - 0.02, 0.392, -1.1), V(X0 - 0.66, 0.392, -1.1)), 0xffffff, null, 'xz');
  // boarding ladder (folded, starboard) and transom grab handles
  kit.add('chrome', tube([V(X0 - 0.5, 0.4, 0.82), V(X0 - 0.5, 0.52, 0.82), V(X0 - 0.2, 0.52, 0.82), V(X0 - 0.2, 0.52, 1.02), V(X0 - 0.5, 0.52, 1.02), V(X0 - 0.5, 0.4, 1.02)], 0.012, 6, false, 3));
  for (const z of [-0.8, 0.8]) kit.add('chrome', tube([V(X0 - 0.015, 0.62, z - 0.1), V(X0 - 0.06, 0.64, z - 0.08), V(X0 - 0.06, 0.64, z + 0.08), V(X0 - 0.015, 0.62, z + 0.1)], 0.011, 6, false, 3));

  // ---- windshield: wrap-around tinted glass in a stainless frame
  const WZ = zin(TW) + 0.11, XWA = XB - 1.25, WD = 1.72;
  const wBase = (a) => { const ph = a * Math.PI / 2, x = XWA + WD * Math.cos(ph) ** 0.8, z = WZ * Math.sign(a) * Math.abs(Math.sin(ph)) ** 0.62; const t = tOfX(x), b = zs(t) + 1e-6; return V(x, ys(t) + crown(Math.max(t, TW)) * (1 - clamp(z / b, -1, 1) ** 2) * sm(XB - 0.05, XB + 0.45, x) - 0.012, z); };
  const wTop = (a) => {
    const b = wBase(a), ph = a * Math.PI / 2, cf = Math.cos(ph), H = 0.07 + 0.64 * sm(0, 0.4, 1 - Math.abs(a));
    const dir = V(XWA - 0.6 - b.x, 0, -b.z * 1.0).normalize(), lf = lerp(0.28, 0.95, cf ** 1.2);
    return V(b.x + dir.x * H * lf, b.y + H + 0.012, b.z + dir.z * H * lf);
  };
  kit.add('glass', loft((t, s, o) => o.lerpVectors(wBase(t * 2 - 1), wTop(t * 2 - 1), s), 48, 3));
  const wline = (f, n = 41) => Array.from({ length: n }, (_, i) => f(-1 + 2 * i / (n - 1)));
  kit.add('chrome', tube(wline(wTop), 0.02, 6, false, 2));
  kit.add('chrome', tube(wline(wBase), 0.02, 6, false, 2));
  for (const a of [-1, -0.42, -0.13, 0.13, 0.42, 1]) kit.add('chrome', rod(wBase(a), wTop(a), 0.016));

  // ---- foredeck: hatch, bow rail, cleats, anchor roller, sidelights
  { const hx = xs(0.72), sl = (deckY(hx + 0.3, 0) - deckY(hx - 0.3, 0)) / 0.6;
    kit.add('deck', rbox(0.66, 0.035, 0.66, 0.017), 0xd9d6cd, M(hx, deckY(hx, 0) + 0.012, 0, 0, 0, Math.atan(sl)));
    kit.add('soft', rbox(0.54, 0.03, 0.54, 0.014), 0x10161a, M(hx, deckY(hx, 0) + 0.022, 0, 0, 0, Math.atan(sl))); }
  { const rail = [], N = 15, T0 = 0.6, T1 = 0.992;
    for (let i = 0; i <= N; i++) { const t = lerp(T0, T1, i / N), z = Math.max(0, zs(t) - 0.075); rail.push(V(xs(t) - (i === N ? 0.02 : 0), ys(t) + 0.33 * sm(T0, T0 + 0.07, t) + 0.01, z)); }
    const all = [...rail.map((p) => V(p.x, p.y, -p.z)), ...rail.slice(0, N).reverse()];
    kit.add('chrome', tube(all, 0.0135, 6, false, 4));
    for (let i = 2; i < N; i += 3) for (const s of [-1, 1]) { const p = rail[i]; kit.add('chrome', rod(V(p.x, deckY(p.x, p.z * s) - 0.01, p.z * s), V(p.x, p.y, p.z * s), 0.011)); kit.add('chrome', cyl(0.024, 0.028, 0.012, 8), 0xffffff, M(p.x, deckY(p.x, p.z) + 0.006, p.z * s)); }
    kit.add('chrome', rod(V(xs(0.975), ys(0.975), 0), V(rail[N].x, rail[N].y, 0), 0.011)); }
  const cleat = (x, y, z, yaw = 0) => {
    const m = M(x, y, z, 0, yaw, 0);
    for (const dx of [-0.035, 0.035]) kit.add('chrome', cyl(0.011, 0.014, 0.034, 6), 0xffffff, m.clone().multiply(M(dx, 0.017, 0)));
    kit.add('chrome', new THREE.CapsuleGeometry(0.012, 0.17, 3, 8), 0xffffff, m.clone().multiply(M(0, 0.042, 0, 0, 0, Math.PI / 2)));
  };
  for (const s of [-1, 1]) {
    cleat(xs(0.86), ys(0.86) + 0.015, s * (zs(0.86) - 0.1), -s * 0.35);
    cleat(xs(0.36), ys(0.36) + 0.004, s * (zs(0.36) - 0.1));
    cleat(xs(0.03), ys(0.03) + 0.004, s * (zs(0.03) - 0.1));
  }
  kit.add('chrome', rbox(0.34, 0.035, 0.11, 0.015), 0xffffff, M(xs(0.985), ys(0.985) + 0.03, 0));                     // anchor roller
  kit.add('chrome', cyl(0.03, 0.03, 0.08, 10), 0xffffff, M(xs(1) + 0.03, ys(1) + 0.02, 0, Math.PI / 2, 0, 0));

  // ---- cockpit: helm console, seats, aft bench, sun pad
  const CREAM = 0xd8d0bf, ACC = 0x1d2f52, DARK = 0x17191c, HZ = 0.52;
  const yb = ys(TW);
  kit.add('soft', rbox(0.5, 0.36, 0.86, 0.07), DARK, M(XB - 0.2, yb - 0.1, HZ));                                 // dash pod
  kit.add('soft', rbox(0.03, 0.26, 0.74, 0.012), 0x0d0e10, M(XB - 0.445, yb - 0.085, HZ, 0, 0, -0.42));          // instrument panel
  kit.add('soft', rbox(0.34, 0.3, 0.7, 0.06), DARK, M(XB - 0.13, yb - 0.1, -HZ));                                // glove box, port
  kit.add('soft', rbox(0.02, 0.62, 0.5, 0.008), 0x0b1114, M(XB - 0.012, SOLE + 0.36, -0.02));                    // cuddy door
  kit.add('chrome', rbox(0.03, 0.03, 0.09, 0.01), 0xffffff, M(XB - 0.03, SOLE + 0.42, 0.17));
  const inst = new Kit();
  { const pm = M(XB - 0.462, yb - 0.078, HZ, 0, 0, -0.42);
    const g = (dy, dz, r) => { inst.add('i', cyl(r, r, 0.006, 20), 0xffffff, pm.clone().multiply(M(-0.004, dy, dz, 0, 0, Math.PI / 2)));
      kit.add('chrome', new THREE.TorusGeometry(r + 0.004, 0.005, 6, 20), 0xffffff, pm.clone().multiply(M(-0.006, dy, dz, 0, Math.PI / 2, 0))); };
    g(0.045, 0.27, 0.05); g(0.045, 0.15, 0.05); g(-0.065, 0.3, 0.028); g(-0.065, 0.22, 0.028); g(-0.065, 0.14, 0.028);
    inst.add('i', box(0.006, 0.17, 0.27), 0xffffff, pm.clone().multiply(M(-0.006, 0, -0.14))); }                 // chart screen
  // wheel: built about local Z, held by a tilted pivot so the caller only spins rotation.z
  const wheelPivot = new THREE.Group(); wheelPivot.name = 'wheel_pivot';
  wheelPivot.position.set(XB - 0.6, yb - 0.2, HZ); wheelPivot.quaternion.setFromUnitVectors(V(0, 0, 1), V(-Math.cos(0.42), Math.sin(0.42), 0));
  kit.add('chrome', rod(V(XB - 0.42, yb - 0.28, HZ), V(XB - 0.6, yb - 0.2, HZ), 0.02, 8));
  const wk = new Kit();
  wk.add('w', new THREE.TorusGeometry(0.185, 0.019, 10, 36), 0x1a1b1d);
  for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3 + Math.PI / 2; wk.add('w', rbox(0.17, 0.035, 0.008, 0.003), 0xc8ccd0, M(Math.cos(a) * 0.095, Math.sin(a) * 0.095, -0.012, 0, 0, a)); }
  wk.add('w', cyl(0.045, 0.05, 0.03, 16), 0xc8ccd0, M(0, 0, -0.012, Math.PI / 2, 0, 0));
  // throttle binnacle
  kit.add('soft', rbox(0.16, 0.07, 0.1, 0.02), DARK, M(XB - 0.5, yb + 0.0, HZ + 0.38));
  for (const dz of [-0.022, 0.022]) { const a = V(XB - 0.5, yb + 0.02, HZ + 0.38 + dz), b = V(XB - 0.44, yb + 0.17, HZ + 0.38 + dz); kit.add('chrome', rod(a, b, 0.008)); kit.add('soft', new THREE.SphereGeometry(0.02, 10, 8), 0x101112, M(b.x, b.y, b.z)); }
  const seat = (x, z) => {
    kit.add('chrome', cyl(0.045, 0.05, 0.3, 12), 0xffffff, M(x, SOLE + 0.15, z)); kit.add('chrome', cyl(0.11, 0.12, 0.02, 16), 0xffffff, M(x, SOLE + 0.01, z));
    kit.add('deck', rbox(0.5, 0.1, 0.5, 0.045), WHITE, M(x, SOLE + 0.34, z));
    kit.add('soft', rbox(0.36, 0.12, 0.44, 0.05), CREAM, M(x - 0.04, SOLE + 0.44, z));
    kit.add('soft', rbox(0.15, 0.14, 0.46, 0.06), CREAM, M(x + 0.19, SOLE + 0.455, z));                           // flip-up bolster
    kit.add('soft', rbox(0.12, 0.6, 0.44, 0.055), CREAM, M(x - 0.27, SOLE + 0.76, z, 0, 0, 0.17));
    kit.add('soft', rbox(0.03, 0.34, 0.2, 0.012), ACC, M(x - 0.215, SOLE + 0.74, z, 0, 0, 0.17));                // accent panel
    for (const s of [-1, 1]) kit.add('soft', rbox(0.2, 0.42, 0.075, 0.035), CREAM, M(x - 0.2, SOLE + 0.72, z + s * 0.235, 0, 0, 0.17));
    kit.add('deck', rbox(0.06, 0.62, 0.48, 0.025), WHITE, M(x - 0.335, SOLE + 0.74, z, 0, 0, 0.17));             // seat shell
  };
  const SX = XB - 1.25; seat(SX, HZ); seat(SX, -HZ);
  { const za = zin(TA) - 0.05;                                                                                    // aft bench + sun pad
    kit.add('deck', rbox(0.55, 0.34, za * 2, 0.03), WHITE, M(XA + 0.29, SOLE + 0.17, 0));
    for (const [z0, z1] of [[-za + 0.02, -0.32], [-0.3, 0.3], [0.32, za - 0.02]]) {
      kit.add('soft', rbox(0.54, 0.12, z1 - z0, 0.05), CREAM, M(XA + 0.31, SOLE + 0.4, (z0 + z1) / 2));
      kit.add('soft', rbox(0.13, 0.4, z1 - z0, 0.055), CREAM, M(XA + 0.075, SOLE + 0.62, (z0 + z1) / 2, 0, 0, 0.12));
    }
    kit.add('soft', rbox(0.035, 0.1, za * 2 - 0.1, 0.014), ACC, M(XA + 0.145, SOLE + 0.74, 0, 0, 0, 0.12));
    kit.add('soft', rbox(0.46, 0.09, zs(0.03) * 2 - 0.5, 0.04), CREAM, M(xs(TA / 2) - 0.02, ys(0.03) + 0.05, 0)); }
  for (const s of [-1, 1])                                                                                       // padded coaming bolsters
    kit.add('soft', loft((t, q, o) => { const a = q * Math.PI; o.set(xs(t), ys(t) - 0.07 - 0.2 * q, s * (zin(t) - 0.012 - 0.045 * Math.sin(a))); }, 14, 5, TA + 0.09, TW - 0.14, s > 0), CREAM);

  // ---- sport arch over the aft cockpit (white gelcoat), swept forward
  const ARCH = { x: 0, y: 0 };
  { const TAr = 0.2, W = zs(TAr) - 0.1, H = 1.08, yb0 = ys(TAr) - 0.04, xb0 = xs(TAr) - 0.25;
    const path = (q, o) => { const a = Math.PI * q, c = Math.cos(a), sn = Math.sin(a); const y = H * Math.abs(sn) ** 0.4; return o.set(xb0 + 0.62 * (y / H) ** 1.3, yb0 + y, -W * Math.sign(c) * Math.abs(c) ** 0.4); };
    const p0 = V(), p1 = V(), tn = V();
    kit.add('deck', loft((q, s, o) => {
      const qq = lerp(0.003, 0.997, q); path(Math.max(0, qq - 0.002), p0); path(Math.min(1, qq + 0.002), p1); tn.subVectors(p1, p0).setX(0).normalize(); path(qq, o);
      const f = (o.y - yb0) / H, ch = lerp(0.27, 0.14, f), th = lerp(0.045, 0.035, f), a = s * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const A = ch * Math.sign(ca) * Math.abs(ca) ** 0.7, Bn = th * Math.sign(sa) * Math.abs(sa) ** 0.7;
      o.x += A; o.y += -tn.z * Bn; o.z += tn.y * Bn;
    }, 56, 14), WHITE);
    ARCH.x = xb0 + 0.62; ARCH.y = yb0 + H + 0.04; }

  // ---- lights
  const lights = { cabin: [] };
  { const lk = new Kit(), t = 0.93;
    for (const [s, key] of [[-1, 'p'], [1, 's']]) { lk.add(key, rbox(0.09, 0.04, 0.035, 0.014), 0xffffff, M(xs(t), ys(t) + 0.035, s * (zs(t) - 0.06), 0, -s * 0.5, 0));
      kit.add('chrome', rbox(0.11, 0.016, 0.05, 0.007), 0xffffff, M(xs(t), ys(t) + 0.012, s * (zs(t) - 0.06), 0, -s * 0.5, 0)); }
    lk.add('w', new THREE.SphereGeometry(0.035, 10, 8), 0xffffff, M(ARCH.x + 0.02, ARCH.y + 0.2, 0));
    kit.add('chrome', rod(V(ARCH.x + 0.02, ARCH.y, 0), V(ARCH.x + 0.02, ARCH.y + 0.18, 0), 0.011));
    kit.add('chrome', rod(V(ARCH.x - 0.05, ARCH.y, -0.5), V(ARCH.x - 0.75, ARCH.y + 1.5, -0.5), 0.006));        // whip aerial
    kit.add('deck', rbox(0.2, 0.07, 0.42, 0.03), WHITE, M(ARCH.x + 0.05, ARCH.y + 0.03, 0.5));                    // radar-ish pod
    lights.port = lk.mesh('p', lamp(0xff1a0a, 'light_port'), 'light_port', false, false);
    lights.starboard = lk.mesh('s', lamp(0x10ff50, 'light_starboard'), 'light_starboard', false, false);
    lights.stern = lk.mesh('w', lamp(0xfff4dc, 'light_stern'), 'light_stern', false, false);
    const im = new THREE.MeshStandardMaterial({ color: 0x06090c, roughness: 0.4, emissive: 0x8fd0ff, emissiveIntensity: 0.1, name: 'boat_instruments' });
    lights.cabin.push(inst.mesh('i', im, 'instruments', false, false)); }

  // ---- twin outboards, each one mesh in a group whose origin is its steering axis
  const EZ = 0.37, EX = X0 - 0.63, EY = 0.22;
  const engine = (name) => {
    const k = new Kit(), GR = 0x1b1d20, GR2 = 0x2c2f33, MET = 0x9a9fa3, COWL = 0xe4e6e8, BAND = hullColor;
    k.add('e', rbox(0.16, 0.34, 0.3, 0.03), GR2, M(0.0, 0.12, 0));                                                // clamp bracket
    const cowl = (t, q, o) => {                                                                                   // t = height, q = round
      const K = (1 - t ** 5) ** 0.34 * (0.9 + 0.1 * sm(0, 0.12, t)), a = q * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const ax = 0.41 * K * (c < 0 ? 1 - 0.16 * t : 1), bz = 0.235 * K * (1 - 0.1 * t);
      o.set(-0.37 + 0.035 * t + ax * Math.sign(c) * Math.abs(c) ** 0.72, 0.4 + 0.56 * t, bz * Math.sign(sn) * Math.abs(sn) ** 0.72);
    };
    k.add('e', loft(cowl, 3, 28, 0, 0.2), GR2); k.add('e', loft(cowl, 1, 28, 0.2, 0.27), BAND); k.add('e', loft(cowl, 12, 28, 0.27, 1), COWL);
    k.add('e', rbox(0.62, 0.14, 0.38, 0.05), GR2, M(-0.36, 0.34, 0));
    k.add('e', rbox(0.3, 0.03, 0.2, 0.012), GR2, M(-0.34, 0.955, 0));                                             // apron
    k.add('e', rbox(0.28, 0.9, 0.17, 0.05, (p) => { const f = (0.45 - p.y) / 0.9; p.z *= 1 - 0.5 * f; p.x *= 1 - 0.2 * f; }), GR, M(-0.38, -0.14, 0));   // leg
    k.add('e', rbox(0.56, 0.022, 0.26, 0.01, (p) => { if (p.x > 0) p.z *= 1 - 0.6 * (p.x / 0.28); }), GR, M(-0.47, -0.6, 0));   // anti-ventilation plate
    k.add('e', new THREE.CapsuleGeometry(0.078, 0.36, 6, 14), GR, M(-0.36, -0.82, 0, 0, 0, Math.PI / 2));         // gearcase
    k.add('e', rbox(0.2, 0.2, 0.09, 0.03), GR, M(-0.4, -0.7, 0));
    { const a = V(-0.2, -0.88, 0), b = V(-0.56, -0.88, 0), c = V(-0.56, -1.12, 0), d = V(-0.46, -1.12, 0), w = 0.012;   // skeg
      for (const s of [-1, 1]) { const o = V(0, 0, s * w), z = V(0, 0, 0); const P = [a.clone().add(o), b.clone().add(o), c, d]; k.add('e', fan(s > 0 ? P : P.reverse()), GR); } }
    k.add('e', cyl(0.05, 0.06, 0.16, 12), MET, M(-0.68, -0.82, 0, 0, 0, Math.PI / 2));                             // prop hub
    for (let i = 0; i < 3; i++) { const a = i * 2 * Math.PI / 3;
      k.add('e', new THREE.SphereGeometry(1, 10, 6), MET, M(-0.68, -0.82, 0, a, 0, 0).multiply(M(0, 0.115, 0, 0, 0.6, 0, 0.012, 0.085, 0.07))); }
    const g = new THREE.Group(); g.name = name; g.add(k.mesh('e', mats.gel, name + '_mesh')); return g;
  };

  // ---- paint: side texture with antifouling, boot stripe, sheer stripe, name and numbers
  const sheerLine = (dy) => Array.from({ length: 60 }, (_, i) => { const t = i / 59; return [xs(t), ys(t) - dy]; });
  const tex = sideTexture('speedboat' + hullColor, 4096, 512, kit.sideMap, (P) => {
    P.band(-9, 9, css(hullColor)); P.band(-9, 0.045, '#7c2a22'); P.band(0.045, 0.12, '#e9e6de');
    P.line(sheerLine(0.2), 0.028, '#c9a55a'); P.line(sheerLine(0.245), 0.011, '#c9a55a');
    P.text('Knot Guilty', -2.25, 0.36, 0.2, 'italic bold %px "Nimbus Roman", "Liberation Serif", "Times New Roman", serif', '#d9b869', { shadow: 'rgba(0,0,0,0.45)', skew: 0.08 });
    P.text('GOWANUS 28', -0.45, 0.6, 0.07, 'bold %px "Liberation Sans", "Nimbus Sans", Arial, sans-serif', '#c9cdd3', { spacing: 3 });
    P.text('NY 2030 MG', 2.55, 0.78, 0.115, 'bold %px "Liberation Sans", "Nimbus Sans", Arial, sans-serif', '#e9e6de', { spacing: 2 });
  }, (P) => { P.band(-9, 9, grey(0.2)); P.band(-9, 0.045, grey(0.85)); });
  const mats = paints();
  mats.hull = new THREE.MeshPhysicalMaterial({ map: tex.map, roughnessMap: tex.rough, roughness: 1, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.1, name: 'speedboat_hull' });

  const object = new THREE.Group(); object.name = 'speedboat';
  object.add(kit.mesh('hull', mats.hull, 'hull'), kit.mesh('deck', mats.gel, 'deck'), kit.mesh('teak', mats.teak, 'teak'), kit.mesh('soft', mats.soft, 'upholstery'),
    kit.mesh('chrome', mats.chrome, 'stainless'), kit.mesh('glass', mats.glass, 'windshield', false, false));
  object.getObjectByName('windshield').renderOrder = 2;
  const wheel = wk.mesh('w', mats.gel, 'wheel'); wheelPivot.add(wheel); object.add(wheelPivot);
  const engines = [engine('engine_port'), engine('engine_starboard')];
  engines[0].position.set(EX, EY, -EZ); engines[1].position.set(EX, EY, EZ); object.add(...engines);
  object.add(lights.port, lights.starboard, lights.stern, ...lights.cabin);

  // ---- spec
  const wl = [];                                                 // waterline half-outline, stern -> bow (starboard)
  for (let i = 0; i <= 9; i++) {
    const t = 0.924 * (i / 9) ** 0.8, k = knots(t), sh = sheerP(t), c = k[8];
    if (c.y < 0) { const s = -c.y / (sh.y - c.y), e = 1 + 1.5 * sm(0.3, 1, t); wl.push([lerp(c.x, sh.x, s), c.z + (sh.z - c.z) * s ** e]); }
    else { const f = clamp(-k[0].y / (k[7].y - k[0].y), 0, 1); wl.push([lerp(k[0].x, k[7].x, f), k[7].z * f]); }
  }
  const r2 = (a) => a.map((v) => Math.round(v * 1000) / 1000);
  const hull = [...wl.slice().reverse().map(r2), ...wl.slice(0, -1).map(([x, z]) => r2([x, -z]))];   // bow, down the starboard side, stern, up the port side
  const spec = {
    kind: 'speedboat', name: 'Knot Guilty', len: 8.6, beam: 2.6, draft: 0.47, freeboard: +ys(0.43).toFixed(2), mass: 2600,
    hull, float: [[3.2, 0], [1.4, -0.75], [1.4, 0.75], [-2.9, -0.9], [-2.9, 0.9], [-3.6, 0]],
    helm: r2([SX + 0.42, SOLE, HZ]), helmPose: 'sit', eye: r2([SX - 0.02, SOLE + 1.2, HZ]),
    props: [r2([EX - 0.68, EY - 0.82, -EZ]), r2([EX - 0.68, EY - 0.82, EZ])], bow: r2([xk(0.924), 0, 0]),
    board: [r2([xs(0.3), ys(0.3), -(zs(0.3) - 0.1)]), r2([xs(0.3), ys(0.3), zs(0.3) - 0.1])],
    decks: [{ x0: +XA.toFixed(2) + 0.6, x1: +XB.toFixed(2) - 0.05, z0: -0.95, z1: 0.95, y: SOLE }, { x0: X0 - 0.66, x1: X0 - 0.02, z0: -1.1, z1: 1.1, y: 0.39 }],
    overall: 9.7,                                                // with bracket and engines
  };
  return { object, spec, parts: { engines, wheel, lights } };
}

// ================================================================ ship helpers (ferry, tug, tour)
const X_ = V(1, 0, 0), Y_ = V(0, 1, 0), Z_ = V(0, 0, 1), NX_ = V(-1, 0, 0), NZ_ = V(0, 0, -1);
// a flat rectangle centred on c, spanned by unit vectors u (width w) and v (height h); it faces u x v
function plate(c, u, v, w, h) {
  const a = c.clone().addScaledVector(u, -w / 2).addScaledVector(v, -h / 2), b = a.clone().addScaledVector(u, w);
  return quad(a, b, b.clone().addScaledVector(v, h), a.clone().addScaledVector(v, h));
}
const facing = (d) => (d > 0 ? NZ_ : Z_);                       // u axis for a plate that faces +X (d > 0) or -X
// round-bilge displacement hull. P: x0, L, bd(t) deck half-beam, bw(t) waterline half-beam, d(t) keel depth, F(t) sheer height,
// optional rake(t, y), e (bilge squareness), fl (flare), transom
function shipHull(kit, P, nt = 60) {
  P.tt = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t); P.e = P.e || 0.6; P.fl = P.fl || 1; P.nt = nt;
  P.xOf = (t, y) => P.x0 + P.L * t + (P.rake ? P.rake(t, y) : 0);
  P.pt = (t, s, o) => {
    if (s < 0.5) { const th = s * Math.PI; o.set(0, -P.d(t) * Math.max(0, Math.cos(th)) ** P.e, P.bw(t) * Math.sin(th) ** P.e); }
    else { const k = (s - 0.5) * 2; o.set(0, P.F(t) * k, lerp(P.bw(t), P.bd(t), k ** P.fl)); }
    o.x = P.xOf(t, o.y); return o;
  };
  P.tOfX = (x) => clamp((x - P.x0) / P.L, 0, 1);
  P.zAt = (x, y) => { let t = P.tOfX(x); if (P.rake) for (let i = 0; i < 5; i++) t = clamp((x - P.x0 - P.rake(t, y)) / P.L, 0, 1); return lerp(P.bw(t), P.bd(t), clamp(y / P.F(t), 0, 1) ** P.fl); };
  P.zY = (t, y) => lerp(P.bw(t), P.bd(t), clamp(y / P.F(t), 0, 1) ** P.fl);
  P.plan = (x) => P.bd(P.tOfX(x));
  kit.side(loft((t, s, o) => P.pt(P.tt(t), s, o), nt, 16));
  if (P.transom) { const pts = [V(P.x0, P.F(0), 0)]; for (let j = 0; j <= 16; j++) pts.push(P.pt(0, j / 16, V())); kit.side(fan(pts)); }
}
// deck inside the hull at height y(t), and the bulwark (inner face + cap) where the sheer stands above it
function shipDeck(kit, P, y, th, cDeck, cIn, cCap = cIn) {
  const edge = (t) => Math.max(0, P.zY(t, y(t)) - th), nt = P.nt;
  kit.mir('paint', loft((t, s, o) => { const q = P.tt(t); o.set(P.xOf(q, y(q)), y(q), edge(q) * (1 - s)); }, nt, 1), cDeck);
  if (!th) return;
  kit.mir('paint', loft((t, s, o) => { const q = P.tt(t), F = P.F(q); o.set(P.xOf(q, lerp(F, y(q), s)), lerp(F, y(q), s), lerp(Math.max(0, P.bd(q) - th), edge(q), s)); }, nt, 1), cIn);
  kit.mir('paint', loft((t, s, o) => { const q = P.tt(t), F = P.F(q); o.set(P.xOf(q, F), F + 0.002, Math.max(0, P.bd(q) - th * s)); }, nt, 1), cCap);
}
const ez = (e) => (t) => (e === 2 ? 0.5 - 0.5 * Math.cos(Math.PI * t) : e === 1 ? 1 - (1 - t) ** 2 : e === -1 ? t * t : t);
// side walls following a plan zf(x) between x0 and x1, both sides
function walls(kit, key, color, zf, x0, x1, y0, y1, n = 16, o = {}) {
  const E = ez(o.ease || 0);
  kit.mir(key, loft((t, s, v) => { const x = lerp(x0, x1, E(t)); v.set(x, lerp(y0, y1, s), Math.max(0, zf(x))); }, n, 1, 0, 1, !!o.inner), color, null, key === 'hull' ? 1 : null);
}
function ends(kit, key, color, zf, x0, x1, y0, y1) {
  for (const [x, d] of [[x0, -1], [x1, 1]]) { const z = Math.max(0, zf(x)); if (z > 0.01) kit.add(key, plate(V(x, (y0 + y1) / 2, 0), facing(d), Y_, 2 * z, y1 - y0), color); }
}
function house(kit, color, zf, x0, x1, y0, y1, n = 16, ease = 0) { walls(kit, 'paint', color, zf, x0, x1, y0, y1, n, { ease }); ends(kit, 'paint', color, zf, x0, x1, y0, y1); }
function slab(kit, zf, x0, x1, yTop, th, n, cTop, cEdge = cTop, cBot = cEdge, ease = 0) {
  const E = ez(ease), X = (t) => lerp(x0, x1, E(t));
  kit.mir('paint', loft((t, s, v) => { const x = X(t); v.set(x, yTop, Math.max(0, zf(x)) * (1 - s)); }, n, 1), cTop);
  kit.mir('paint', loft((t, s, v) => { const x = X(t); v.set(x, yTop - th, Math.max(0, zf(x)) * (1 - s)); }, n, 1, 0, 1, true), cBot);
  walls(kit, 'paint', cEdge, zf, x0, x1, yTop - th, yTop, n, { ease }); ends(kit, 'paint', cEdge, zf, x0, x1, yTop - th, yTop);
}
// a row of windows on both sides, lying just proud of the wall zf(x)
function wins(wk, zf, xa, xb, y0, y1, pitch, gap, off = 0.035) {
  const n = Math.max(1, Math.floor((xb - xa) / pitch)), st = (xb - xa) / n;
  for (let i = 0; i < n; i++) {
    const xl = xa + i * st + gap / 2, xr = xa + (i + 1) * st - gap / 2, zl = zf(xl) + off, zr = zf(xr) + off;
    wk.mir('w', quad(V(xl, y0, zl), V(xr, y0, zr), V(xr, y1, zr), V(xl, y1, zl)));
  }
}
function winsEnd(wk, x, d, zHalf, y0, y1, n, gap, off = 0.035) {
  const st = (2 * zHalf) / n;
  for (let i = 0; i < n; i++) wk.add('w', plate(V(x + d * off, (y0 + y1) / 2, -zHalf + (i + 0.5) * st), facing(d), Y_, st - gap, y1 - y0));
}
// railing through deck-level points
function rail(kit, pts, h, color = 0xdcdad2, r = 0.028, mid = true) {
  const up = V(0, h, 0), um = V(0, h * 0.5, 0);
  for (let i = 0; i < pts.length; i++) {
    kit.add('paint', rod(pts[i], pts[i].clone().add(up), r, 5, true), color);
    if (i === pts.length - 1) break;
    kit.add('paint', rod(pts[i].clone().add(up), pts[i + 1].clone().add(up), r * 1.25, 5, true), color);
    if (mid) kit.add('paint', rod(pts[i].clone().add(um), pts[i + 1].clone().add(um), r * 0.8, 5, true), color);
  }
}
const railRun = (zf, x0, x1, y, n, s = 1) => Array.from({ length: n + 1 }, (_, i) => { const x = lerp(x0, x1, i / n); return V(x, y, s * zf(x)); });
function ellStack(kit, x, y0, h, rx, rz, bands) {             // bands: [[fraction0, fraction1, colour, extra radius]]
  for (const [f0, f1, c, ex = 0] of bands) kit.add('paint', cyl(1 + ex, 1 + ex, h * (f1 - f0), 22), c, M(x, y0 + h * (f0 + f1) / 2, 0, 0, 0, 0, rx, 1, rz));
}
function rudder(mat, x, y, h, chord) {
  const k = new Kit(); k.add('r', rbox(chord, h, 0.05 + chord * 0.07, 0.02), 0x1a1b1d, M(-chord * 0.25, -h / 2, 0)); k.add('r', cyl(0.07, 0.07, 0.5, 8), 0x1a1b1d, M(0, 0.2, 0));
  const g = new THREE.Group(); g.name = 'rudder'; g.position.set(x, y, 0); g.add(k.mesh('r', mat, 'rudder_mesh')); return g;
}
function propeller(kit, x, y, z, r, color = 0xa07f3c) {
  kit.add('paint', cyl(r * 0.2, r * 0.24, r * 0.5, 10), color, M(x, y, z, 0, 0, Math.PI / 2));
  kit.add('paint', rod(V(x, y, z), V(x + r * 2.4, y + r * 0.25, z), r * 0.09, 6), 0x1a1b1d);
  for (let i = 0; i < 4; i++) kit.add('paint', new THREE.SphereGeometry(1, 8, 5), color, M(x, y, z, i * Math.PI / 2, 0, 0).multiply(M(0, r * 0.58, 0, 0, 0.65, 0, r * 0.05, r * 0.44, r * 0.3)));
}
// painted names: an atlas of text rows, laid on the surface as blended decals
function signs(key, rows) {
  if (texCache.has(key)) return texCache.get(key);
  const W = 2048; let H = 0; for (const r of rows) H += r.px + 24; H = 2 ** Math.ceil(Math.log2(H));
  const c = canvas(W, H), g = c.getContext('2d'), rect = [], aspect = []; let y = 0;
  for (const r of rows) {
    g.font = r.font.replace('%', r.px); g.textBaseline = 'middle'; g.textAlign = 'left'; if ('letterSpacing' in g) g.letterSpacing = (r.spacing || 0) + 'px';
    const w = Math.min(W - 24, g.measureText(r.text).width + (r.spacing || 0));
    if (r.stroke) { g.strokeStyle = r.stroke; g.lineWidth = r.px * 0.1; g.lineJoin = 'round'; g.strokeText(r.text, 12, y + 12 + r.px / 2, W - 24); }
    g.fillStyle = r.color; g.fillText(r.text, 12, y + 12 + r.px / 2, W - 24);
    rect.push([4 / W, 1 - (y + 22 + r.px) / H, (w + 20) / W, 1 - (y + 2) / H]); aspect.push((w + 16) / (r.px + 20)); y += r.px + 24;
  }
  const tex = finishTex(c); tex.premultiplyAlpha = true;
  const out = { tex, rect, aspect }; texCache.set(key, out); return out;
}
const signMat = (tex) => new THREE.MeshStandardMaterial({ map: tex, transparent: true, premultipliedAlpha: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.5, name: 'boat_lettering' });
// one name on both sides of a surface z = zf(x, y): centre xc, bottom y0, letter-row height h
function nameOn(dk, S, row, zf, xc, y0, h, n = 10, off = 0.03) {
  const w = h * S.aspect[row], xa = xc - w / 2, xb = xc + w / 2, r = S.rect[row];
  for (const side of [1, -1]) {
    const g = loft((t, s, o) => { const x = side > 0 ? lerp(xa, xb, t) : lerp(xb, xa, t), y = lerp(y0, y0 + h, s); o.set(x, y, side * (zf(x, y) + off)); }, n, 1);
    const uv = new Float32Array((n + 1) * 4); let k = 0;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= 1; j++) { uv[k++] = lerp(r[0], r[2], i / n); uv[k++] = lerp(r[1], r[3], j); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); dk.add('d', g);
  }
}
function navLights(defs) {                                      // defs: { port: [x,y,z], starboard: [...], stern: [...] }, size
  const lk = new Kit(), s = defs.size || 0.3, out = {};
  for (const [key, col] of [['port', 0xff1a0a], ['starboard', 0x10ff50], ['stern', 0xfff4dc]]) {
    lk.add(key, box(s, s * 0.8, s * 0.7), 0xffffff, M(...defs[key])); out[key] = lk.mesh(key, lamp(col, 'light_' + key), 'light_' + key, false, false);
  }
  return out;
}
function waterlinePoly(P, n = 9) {                             // bow first, down the starboard side, round the stern, up the port side
  const r = (v) => Math.round(v * 100) / 100, st = []; for (let i = 0; i <= n; i++) st.push([r(P.x0 + P.L * i / n), r(P.bw(i / n))]);
  const res = st.slice().reverse(), port = st.filter(([, z]) => z > 0.01).map(([x, z]) => [x, -z]);
  return [...res, ...port];
}
function shipBands(key, map, bands) {
  return sideTexture(key, 64, 512, map, (P) => { for (const [y0, y1, c] of bands) P.band(y0, y1, css(c)); }).map;
}
function assemble(name, kit, wk, dk, hullTex, S, mats) {
  const object = new THREE.Group(); object.name = name;
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTex, roughness: 0.5, metalness: 0.05, name: name + '_hull' });
  const windows = wk.mesh('w', windowMat(), 'windows', false, true);
  object.add(kit.mesh('hull', hullMat, 'hull'), kit.mesh('paint', mats.paint, 'paintwork'), windows);
  if (dk && dk.b.size) { const m = dk.mesh('d', signMat(S.tex), 'lettering', false, false); m.renderOrder = 1; object.add(m); }
  return { object, windows };
}
const SANS = 'bold %px "Liberation Sans", "Nimbus Sans", Arial, Helvetica, sans-serif';

// ================================================================ FERRY  "Stately Island Ferry", vessel "Fuhgeddaboutit" (both invented)
function ferry(opts) {
  const ORANGE = opts.color ?? 0xd9661a, NAVY = 0x15233f, CREAM = 0xd8d2c0, DECK = 0x565a5c, BLACK = 0x141516, WHITE = 0xe2e0d8;
  const L = 66, HL = 33, D = 3.2, MAIN = 2.4, SAL = 5.9, BRI = 8.9, TOP = 11.5, PH = BRI + 3.4;
  const shape = (a) => (a < 0.45 ? 1 : a >= 1 ? 0 : (1 - ((a - 0.45) / 0.55) ** 2.3) ** (1 / 2.3));
  const P = { x0: -HL, L, e: 0.55, bd: (t) => 7 * shape(Math.abs(2 * t - 1)), bw: (t) => 6.75 * shape(Math.abs(2 * t - 1) * 1.05),
    d: (t) => D * (1 - Math.min(1, Math.abs(2 * t - 1) * 1.05) ** 3) ** 0.6, F: () => MAIN };
  const kit = new Kit({ x0: -HL - 0.2, x1: HL + 0.2, y0: -3.6, y1: 9.4 }), wk = new Kit(), dk = new Kit(), mats = paints();
  shipHull(kit, P, 64);
  shipDeck(kit, P, () => MAIN, 0, DECK);
  kit.mir('paint', loft((t, s, o) => { const q = P.tt(t), a = (s - 0.5) * Math.PI; o.set(P.x0 + L * q + Math.sign(q - 0.5) * 0.2 * sm(0.9, 1, Math.abs(2 * q - 1)), MAIN - 0.22 + 0.25 * Math.sin(a), Math.max(0, P.bd(q) - 0.03 + 0.24 * Math.cos(a))); }, 64, 4), BLACK);   // fender guard
  const wz = (x) => P.plan(x) - 0.12, Wm = 27, Ws = 24.5;
  // main (vehicle and passenger) deck: side walls with big openings, open at both ends
  walls(kit, 'hull', 0xffffff, wz, -Wm, Wm, MAIN, SAL, 40);
  walls(kit, 'paint', CREAM, (x) => wz(x) - 0.3, -Wm, Wm, MAIN, SAL - 0.3, 40, { inner: true });
  for (const d of [-1, 1]) for (const s of [-1, 1]) kit.add('paint', plate(V(d * Wm, (MAIN + SAL) / 2, s * (wz(Wm) - 0.15)), facing(d), Y_, 0.3, SAL - MAIN), ORANGE);
  wins(wk, wz, -25.6, 25.6, MAIN + 1.25, MAIN + 2.65, 2.13, 0.75);
  house(kit, CREAM, () => 1.5, -9, 9, MAIN, SAL - 0.3, 2);                                     // centre casing (stairs, uptakes)
  for (const x of [-6, 0, 6]) for (const s of [-1, 1]) kit.add('paint', plate(V(x, MAIN + 1.05, s * 1.52), s > 0 ? X_ : NX_, Y_, 1.0, 2.1), NAVY);
  // saloon deck
  slab(kit, P.plan, -29.6, 29.6, SAL, 0.3, 44, DECK, NAVY, CREAM);
  walls(kit, 'hull', 0xffffff, wz, -Ws, Ws, SAL, BRI, 36); ends(kit, 'paint', ORANGE, wz, -Ws, Ws, SAL, BRI);
  wins(wk, wz, -23.7, 23.7, SAL + 1.15, SAL + 2.25, 1.44, 0.42);
  for (const d of [-1, 1]) { winsEnd(wk, d * Ws, d, wz(Ws) - 0.5, SAL + 1.15, SAL + 2.25, 7, 0.4); kit.add('paint', plate(V(d * (Ws + 0.03), SAL + 1.05, 0), facing(d), Y_, 1.5, 2.1), NAVY); }
  // bridge deck: long house with a pilot house at each end
  slab(kit, P.plan, -25.6, 25.6, BRI, 0.25, 40, DECK, NAVY, CREAM);
  house(kit, ORANGE, () => 4.6, -18, 18, BRI, TOP, 2); wins(wk, () => 4.6, -17.3, 17.3, BRI + 1.1, BRI + 2.0, 1.45, 0.45);
  slab(kit, () => 4.9, -18.2, 18.2, TOP + 0.18, 0.18, 2, WHITE);
  const pz = (x) => { const a = clamp((Math.abs(x) - 18) / 4.6, 0, 1); return 3.5 * (1 - a ** 2.6) ** (1 / 2.6); };
  const pr = (x) => { const a = clamp((Math.abs(x) - 17.6) / 5.5, 0, 1); return 3.9 * (1 - a ** 2.6) ** (1 / 2.6); };
  for (const d of [-1, 1]) {
    const xa = d > 0 ? 18 : -22.6, xb = d > 0 ? 22.6 : -18;
    walls(kit, 'paint', ORANGE, pz, xa, xb, BRI, PH, 18, { ease: d }); kit.add('paint', plate(V(d * 18, (BRI + PH) / 2, 0), facing(-d), Y_, 7, PH - BRI), ORANGE);
    slab(kit, pr, d > 0 ? 17.6 : -23.1, d > 0 ? 23.1 : -17.6, PH + 0.2, 0.2, 18, WHITE, WHITE, WHITE, d);
    for (let i = 0; i < 9; i++) {                                                             // wrap-around pilot house windows
      const a0 = lerp(0.06, 0.985, i / 9), a1 = lerp(0.06, 0.985, (i + 1) / 9) - 0.03, xl = d * (18 + 4.6 * a0), xr = d * (18 + 4.6 * a1);
      const g = quad(V(xl, BRI + 1.7, pz(xl) + 0.04), V(xr, BRI + 1.7, pz(xr) + 0.04), V(xr, BRI + 2.8, pz(xr) + 0.04), V(xl, BRI + 2.8, pz(xl) + 0.04));
      wk.add('w', g.clone(), 0xffffff, d > 0 ? null : MIRROR); wk.add('w', g, 0xffffff, d > 0 ? MIRROR : null);
    }
    kit.add('paint', rod(V(d * 20, PH + 0.2, 0), V(d * 20, PH + 2.6, 0), 0.07, 6), WHITE); kit.add('paint', rod(V(d * 20, PH + 2.0, -1.1), V(d * 20, PH + 2.0, 1.1), 0.04, 5), WHITE);
    kit.add('paint', box(0.25, 0.14, 1.6), WHITE, M(d * 21, PH + 0.45, 0)); kit.add('paint', cyl(0.12, 0.12, 0.25, 8), WHITE, M(d * 21, PH + 0.3, 0));   // radar
  }
  // funnels, mast, rafts, vents
  for (const x of [-5.5, 5.5]) ellStack(kit, x, TOP + 0.18, 4.6, 1.55, 1.1, [[0, 0.8, ORANGE], [0.52, 0.64, NAVY, 0.012], [0.8, 1, BLACK, 0.02]]);
  kit.add('paint', rod(V(0, TOP + 0.18, 0), V(0, TOP + 6.4, 0), 0.09, 6), WHITE); kit.add('paint', rod(V(0, TOP + 5.2, -1.6), V(0, TOP + 5.2, 1.6), 0.05, 5), WHITE);
  for (const x of [-14, -11, 11, 14]) for (const s of [-1, 1]) kit.add('paint', new THREE.CapsuleGeometry(0.42, 1.0, 3, 10), WHITE, M(x, TOP + 0.6, s * 3.4, 0, 0, Math.PI / 2));
  for (const x of [-1.6, 1.6]) kit.add('paint', rbox(1.6, 0.9, 2.2, 0.12), CREAM, M(x * 1.2, TOP + 0.6, 0));
  // rails: bridge deck, saloon-deck ends, main-deck aprons
  const rz = (x) => P.plan(x) - 0.22;
  for (const s of [-1, 1]) {
    rail(kit, railRun(rz, -25.4, 25.4, BRI, 22, s), 1.05);
    for (const d of [-1, 1]) { rail(kit, railRun(rz, d * Ws, d * 29.4, SAL, 3, s), 1.05); rail(kit, railRun(rz, d * Wm, d * 31.3, MAIN, 3, s), 1.05, 0x222426); }
  }
  for (const d of [-1, 1]) { rail(kit, railRun(() => 0, d * 25.4, d * 25.4, BRI, 1).map((p, i) => p.setZ(i ? rz(25.4) : -rz(25.4))), 1.05); rail(kit, [V(d * 29.4, SAL, -rz(29.4)), V(d * 29.4, SAL, 0), V(d * 29.4, SAL, rz(29.4))], 1.05); }
  // stern gear at the -X end
  propeller(kit, -28.3, -2.3, 0, 0.8); const rud = rudder(mats.paint, -30.0, -1.25, 1.9, 1.5);
  // paint and names
  const hullTex = shipBands('ferry' + ORANGE, kit.sideMap, [[-9, 99, ORANGE], [-9, 1.0, BLACK], [-9, 0.12, 0x6e2019]]);
  const S = signs('ferry-signs', [{ text: 'STATELY ISLAND FERRY', font: SANS, color: css(NAVY), px: 150, spacing: 10 }, { text: 'FUHGEDDABOUTIT', font: SANS, color: css(NAVY), px: 96, spacing: 6 }]);
  nameOn(dk, S, 0, (x) => wz(x), 0, SAL + 0.12, 0.92, 12);
  for (const x of [-12.5, 12.5]) nameOn(dk, S, 1, () => 4.6, x, BRI + 0.3, 0.55, 2);
  const { object, windows } = assemble('ferry', kit, wk, dk, hullTex, S, mats); object.add(rud);
  const nl = navLights({ size: 0.4, port: [20, PH - 0.3, -3.3], starboard: [20, PH - 0.3, 3.3], stern: [-22.7, PH - 0.4, 0] }); object.add(nl.port, nl.starboard, nl.stern);
  const spec = {
    kind: 'ferry', name: 'Stately Island Ferry', len: 66, beam: 14.4, draft: D, freeboard: MAIN, mass: 1.5e6,
    hull: waterlinePoly(P, 10), float: [[27, 0], [14, -5.2], [14, 5.2], [-14, -5.2], [-14, 5.2], [-27, 0]],
    helm: [20.2, BRI, 0], helmPose: 'stand', eye: [20.4, BRI + 1.7, 0], props: [[-28.3, -2.3, 0]], bow: [31.4, 0, 0],
    board: [[29, MAIN, -4.2], [29, MAIN, 4.2], [-29, MAIN, -4.2], [-29, MAIN, 4.2]],
    decks: [{ x0: -27, x1: 27, z0: -6.4, z1: 6.4, y: MAIN }, { x0: 27, x1: 31.6, z0: -3.4, z1: 3.4, y: MAIN }, { x0: -31.6, x1: -27, z0: -3.4, z1: 3.4, y: MAIN },
      { x0: 18.3, x1: 21.6, z0: -2.4, z1: 2.4, y: BRI }, { x0: -21.6, x1: -18.3, z0: -2.4, z1: 2.4, y: BRI }],
    blocks: [{ x0: -9, x1: 9, z0: -1.5, z1: 1.5, y0: MAIN, y1: SAL }],     // the centre casing standing on the main deck
    helmAft: [-20.2, BRI, 0],                                              // the pilot house at the other end
  };
  return { object, spec, parts: { engines: [rud], wheel: null, lights: { ...nl, cabin: [windows] } } };
}

// ================================================================ TUG  "Nudge Judy" of McShove Towing (both invented)
function tug(opts) {
  const HULL = opts.color ?? 0x161718, RED = 0x94301f, CREAM = 0xd9cfae, DECK = 0x3f4c46, BLACK = 0x0f1011, BUL = 0x7d2a1e, GREY = 0x33373a;
  const L = 26, HL = 13, D = 3.2, HB = 4.1;
  const bd = (t) => (t < 0.3 ? HB * (1 - (1 - t / 0.3) ** 2.4) ** (1 / 2.4) : t < 0.55 ? HB : HB * (1 - ((t - 0.55) / 0.45) ** 2.1) ** 0.62);
  const F = (t) => 1.5 + 1.75 * sm(0.42, 1, t) ** 1.3 + 0.2 * (1 - sm(0, 0.3, t)), dy = (t) => F(t) - 0.85;
  const P = { x0: -HL, L, bd, bw: (t) => 0.94 * bd(t) * Math.sqrt(sm(0.02, 0.16, t)), d: (t) => D * sm(0.02, 0.3, t) ** 0.6 * (1 - 0.35 * sm(0.75, 1, t)), F, fl: 1.2, rake: (t, y) => 0.16 * y * sm(0.8, 1, t) };
  const kit = new Kit({ x0: -HL - 0.3, x1: HL + 1, y0: -3.5, y1: 3.9 }), wk = new Kit(), dk = new Kit(), mats = paints();
  shipHull(kit, P, 56); shipDeck(kit, P, dy, 0.14, DECK, BUL, BLACK);
  const dyx = (x) => dy(P.tOfX(x));
  // deckhouse (red), wheelhouse (cream), funnel
  const hz = (x) => (x >= 6.4 ? 0 : x > 4 ? 2.45 * (1 - ((x - 4) / 2.4) ** 2.6) ** (1 / 2.6) : 2.45);
  house(kit, RED, hz, -2.6, 6.4, 0.55, 3.5, 26, 1);
  slab(kit, (x) => (x >= 6.5 ? 0 : hz(Math.min(x, 6.39) - 0.1) + 0.14), -2.8, 6.5, 3.62, 0.12, 26, CREAM, CREAM, CREAM, 1);
  for (const x of [-1.7, -0.4, 2.2, 3.5]) { wk.mir('w', cyl(0.2, 0.2, 0.02, 14), 0xffffff, M(x, 2.55, 2.47, Math.PI / 2, 0, 0)); kit.mir('paint', new THREE.TorusGeometry(0.22, 0.04, 5, 14), 0xa8873a, M(x, 2.55, 2.47)); }
  kit.mir('paint', plate(V(0.9, dyx(0.9) + 1.0, 2.47), X_, Y_, 0.8, 1.9), 0x5a1d14);
  kit.add('paint', plate(V(-2.62, dyx(-2.6) + 1.0, 0), Z_, Y_, 0.85, 1.9), 0x5a1d14);
  const wz = (x) => (x >= 5.6 ? 0 : x > 4 ? 1.85 * (1 - ((x - 4) / 1.6) ** 2.4) ** (1 / 2.4) : 1.85);
  house(kit, CREAM, wz, 1.4, 5.6, 3.62, 6.1, 20, 1);
  for (let i = 0; i < 7; i++) { const a0 = 1.6 + i * 0.56, a1 = a0 + 0.45; if (a1 < 5.5) wk.mir('w', quad(V(a0, 4.75, wz(a0) + 0.035), V(a1, 4.75, wz(a1) + 0.035), V(a1, 5.72, wz(a1) + 0.035), V(a0, 5.72, wz(a0) + 0.035))); }
  winsEnd(wk, 1.4, -1, 1.55, 4.75, 5.72, 3, 0.14);
  slab(kit, (x) => (x >= 6.1 ? 0 : x > 4.1 ? 2.15 * (1 - ((x - 4.1) / 2.0) ** 2.4) ** (1 / 2.4) : 2.15), 1.1, 6.1, 6.26, 0.16, 20, RED, RED, CREAM, 1);
  kit.add('paint', rod(V(3.0, 6.26, 0), V(3.0, 9.7, 0), 0.07, 6), CREAM); kit.add('paint', rod(V(3.0, 8.6, -1.2), V(3.0, 8.6, 1.2), 0.04, 5), CREAM);
  kit.add('paint', box(0.2, 0.12, 1.5), CREAM, M(4.2, 6.75, 0)); kit.add('paint', cyl(0.1, 0.1, 0.42, 8), CREAM, M(4.2, 6.47, 0));                    // radar
  kit.add('paint', cyl(0.2, 0.16, 0.3, 10), GREY, M(5.0, 6.45, 0.9, 0, 0, Math.PI / 2 - 0.2));                                                      // searchlight
  ellStack(kit, -0.9, 3.62, 3.2, 0.85, 0.62, [[0, 1, BLACK], [0.55, 0.78, CREAM, 0.015], [0.62, 0.71, RED, 0.03]]);
  // towing gear
  { const x = -4.9, y = dyx(-4.9);
    for (const s of [-1, 1]) kit.add('paint', cyl(0.2, 0.22, 1.45, 10), BLACK, M(x, y + 0.72, s * 0.8));
    kit.add('paint', rod(V(x, y + 1.05, -1.3), V(x, y + 1.05, 1.3), 0.15, 8), BLACK);
    const wx = -3.55, wy = dyx(wx);
    kit.add('paint', cyl(0.5, 0.5, 1.3, 14), 0x6b5a3a, M(wx, wy + 0.85, 0, Math.PI / 2, 0, 0));                                                        // hawser on the drum
    for (const s of [-1, 1]) kit.add('paint', cyl(0.78, 0.78, 0.08, 16), GREY, M(wx, wy + 0.85, s * 0.7, Math.PI / 2, 0, 0));
    kit.add('paint', box(1.2, 0.5, 1.7), GREY, M(wx, wy + 0.25, 0)); }
  { const x = 9.5, y = dyx(9.5); kit.add('paint', cyl(0.3, 0.36, 0.75, 12), GREY, M(x, y + 0.37, 0)); kit.add('paint', cyl(0.42, 0.42, 0.08, 12), GREY, M(x, y + 0.78, 0));
    for (const s of [-1, 1]) for (const dx of [-0.3, 0.3]) kit.add('paint', cyl(0.13, 0.15, 0.6, 8), BLACK, M(8.0 + dx, dyx(8) + 0.3, s * 1.5)); }
  for (const s of [-1, 1]) for (const dx of [-0.3, 0.3]) kit.add('paint', cyl(0.13, 0.15, 0.55, 8), BLACK, M(-9.2 + dx, dyx(-9.2) + 0.27, s * 1.9));
  // tyre fenders, bow pudding, stern fender
  for (let i = 0; i < 9; i++) {
    const t = lerp(0.13, 0.74, i / 8), y = F(t) - 0.62, x = P.xOf(t, y), z = P.zY(t, y), e = 0.01, dzdx = (P.zY(t + e, y) - P.zY(t - e, y)) / (2 * e * L), yaw = Math.atan2(-dzdx, 1);
    kit.mir('paint', new THREE.TorusGeometry(0.4, 0.16, 7, 14), 0x0c0c0d, M(x - Math.sin(yaw) * 0.0 + Math.sin(yaw) * 0.17, y, z + Math.cos(yaw) * 0.17, 0, yaw, 0));
    kit.mir('paint', rod(V(x, y + 0.36, z + 0.2), V(x, F(t) + 0.02, P.bd(t) - 0.05), 0.02, 4, true), 0x2a2a2a);
  }
  const fend = (t0, t1, r, n, drop) => { const pts = []; for (let i = 0; i <= n; i++) { const t = lerp(t0, t1, i / n), y = F(t) - drop; pts.push(V(P.xOf(t, y) + (t1 > 0.5 ? 1 : -1) * r * 0.5 * sm(0, 1, i / n), y, i === n ? 0 : Math.max(0, P.zY(t, y)) + r * 0.55)); }
    const all = [...pts, ...pts.slice(0, n).reverse().map((p) => V(p.x, p.y, -p.z))]; kit.add('paint', tube(all, r, 8, false, 3), 0x0c0c0d); };
  fend(0.945, 1, 0.34, 6, 0.38); fend(0.955, 1, 0.28, 5, 1.0); fend(0.12, 0, 0.24, 7, 0.45);
  propeller(kit, -10.1, -2.15, 0, 0.75); const rud = rudder(mats.paint, -11.3, -1.2, 1.8, 1.3);
  const hullTex = shipBands('tug' + HULL, kit.sideMap, [[-9, 99, HULL], [-9, 0.1, 0x74231b]]);
  const S = signs('tug-signs', [{ text: 'NUDGE JUDY', font: SANS, color: '#e6e2d6', px: 130, spacing: 8 }, { text: 'McSHOVE TOWING', font: SANS, color: css(CREAM), px: 100, spacing: 5 }]);
  nameOn(dk, S, 0, P.zAt, 8.6, 1.85, 0.52, 12, 0.035); nameOn(dk, S, 1, () => 2.45, 0.9, 3.0, 0.36, 2);
  const { object, windows } = assemble('tug', kit, wk, dk, hullTex, S, mats); object.add(rud);
  const nl = navLights({ size: 0.26, port: [3.6, 6.38, -2.0], starboard: [3.6, 6.38, 2.0], stern: [-2.75, 3.3, 0] }); object.add(nl.port, nl.starboard, nl.stern);
  const yA = +dyx(-7).toFixed(2);
  const spec = {
    kind: 'tug', name: 'Nudge Judy', len: 26, beam: 8.2, draft: D, freeboard: +F(0.45).toFixed(2), mass: 250e3,
    hull: waterlinePoly(P, 9), float: [[10.5, 0], [5, -3], [5, 3], [-7, -3], [-7, 3], [-11.5, 0]],
    helm: [3.3, 3.62, 0], helmPose: 'stand', eye: [3.5, 5.3, 0], props: [[-10.1, -2.15, 0]], bow: [13, 0, 0],
    board: [[-7, yA, -3.3], [-7, yA, 3.3]], decks: [{ x0: -11, x1: -5.6, z0: -3, z1: 3, y: yA }, { x0: 1.6, x1: 5, z0: -1.6, z1: 1.6, y: 3.62 }],
    bulwark: +F(0.25).toFixed(2),                                            // the rail to step over when boarding aft
  };
  return { object, spec, parts: { engines: [rud], wheel: null, lights: { ...nl, cabin: [windows] } } };
}

// ================================================================ TOUR BOAT  "Circular Logic" sightseeing cruises (invented)
function tour(opts) {
  const WHITE = opts.color ?? 0xe4e2da, GREEN = 0x1d5a3c, RED = 0xb02a22, DECK = 0x5d6a70, BLACK = 0x141516, GREY = 0x8a8f92;
  const L = 40, HL = 20, D = 2.1, HB = 4.6, MAIN = 1.7, TOPD = 4.45;
  const bd = (t) => (t < 0.5 ? HB * (0.84 + 0.16 * sm(0, 0.3, t)) : HB * (1 - ((t - 0.5) / 0.5) ** 2.2) ** 0.9);
  const F = (t) => MAIN + 1.25 * sm(0.62, 1, t) ** 1.5;
  const P = { x0: -HL, L, bd, bw: (t) => bd(t) * 0.93 * (0.78 + 0.22 * sm(0, 0.2, t)), d: (t) => D * (0.45 + 0.55 * sm(0, 0.25, t)) * (1 - 0.5 * sm(0.8, 1, t)), F, fl: 1.15, transom: true,
    rake: (t, y) => 0.45 * Math.max(0, y) * sm(0.72, 1, t) ** 2 };
  const kit = new Kit({ x0: -HL - 0.3, x1: HL + 1.8, y0: -2.4, y1: 3.2 }), wk = new Kit(), dk = new Kit(), mats = paints();
  shipHull(kit, P, 56); shipDeck(kit, P, () => MAIN, 0.1, DECK, WHITE, GREEN);
  // enclosed main deck with big windows
  const cz = (x) => P.plan(x) - 0.4, CA = -17, CF = 11, CT = TOPD - 0.37;
  house(kit, WHITE, cz, CA, CF, MAIN, CT, 30);
  wins(wk, cz, -16.3, 10.5, MAIN + 0.95, MAIN + 2.1, 1.78, 0.32);
  winsEnd(wk, CF, 1, cz(CF) - 0.3, MAIN + 0.95, MAIN + 2.1, 4, 0.25); winsEnd(wk, CA, -1, cz(CA) - 0.4, MAIN + 0.95, MAIN + 2.1, 5, 0.3);
  // top deck slab with green edge and red stripe
  const tz = (x) => (x > 12.4 ? 0 : P.plan(x) - 0.1), TA = -18.3, TF = 12.4;
  slab(kit, tz, TA, TF, TOPD, 0.37, 32, DECK, GREEN, WHITE);
  walls(kit, 'paint', RED, (x) => tz(x) + 0.012, TA, TF, TOPD - 0.37, TOPD - 0.26, 32);
  for (const s of [-1, 1]) kit.add('paint', rod(V(TA + 0.3, MAIN, s * 3.6), V(TA + 0.3, TOPD - 0.3, s * 3.6), 0.07, 6, true), WHITE);
  const rzf = (x) => tz(x) - 0.14;
  for (const s of [-1, 1]) rail(kit, railRun(rzf, TA + 0.15, TF - 0.15, TOPD, 24, s), 1.05);
  rail(kit, [V(TA + 0.15, TOPD, -rzf(TA)), V(TA + 0.15, TOPD, 0), V(TA + 0.15, TOPD, rzf(TA))], 1.05); rail(kit, [V(TF - 0.15, TOPD, -rzf(TF - 0.15)), V(TF - 0.15, TOPD, 0), V(TF - 0.15, TOPD, rzf(TF - 0.15))], 1.05);
  for (const x of [-15, -9, -3, 3, 9]) kit.mir('paint', new THREE.TorusGeometry(0.33, 0.075, 6, 14), 0xd9541a, M(x, TOPD + 0.6, rzf(x) + 0.09));     // life rings
  // rows of benches on the open top deck
  for (let x = -15.6; x < 3.6; x += 1.3) for (const s of [-1, 1]) {
    kit.add('paint', box(0.44, 0.06, 2.7), GREEN, M(x, TOPD + 0.45, s * 1.95)); kit.add('paint', box(0.06, 0.42, 2.7), GREEN, M(x - 0.24, TOPD + 0.74, s * 1.95, 0, 0, 0.14));
    for (const dz of [-1.15, 1.15]) kit.add('paint', box(0.38, 0.42, 0.05), GREY, M(x, TOPD + 0.21, s * 1.95 + dz));
  }
  // wheelhouse, stack, canopy, mast
  const whz = (x) => (x >= 10.2 ? 0 : x > 8.2 ? 2.3 * (1 - ((x - 8.2) / 2) ** 2.4) ** (1 / 2.4) : 2.3);
  house(kit, WHITE, whz, 5.2, 10.2, TOPD, TOPD + 2.4, 22, 1);
  for (let i = 0; i < 6; i++) { const a0 = 5.5 + i * 0.78, a1 = a0 + 0.64; wk.mir('w', quad(V(a0, TOPD + 1.15, whz(a0) + 0.035), V(a1, TOPD + 1.15, whz(a1) + 0.035), V(a1, TOPD + 2.05, whz(a1) + 0.035), V(a0, TOPD + 2.05, whz(a0) + 0.035))); }
  winsEnd(wk, 5.2, -1, 1.9, TOPD + 1.15, TOPD + 2.05, 3, 0.2);
  slab(kit, (x) => (x >= 10.8 ? 0 : x > 8.3 ? 2.6 * (1 - ((x - 8.3) / 2.5) ** 2.4) ** (1 / 2.4) : 2.6), 4.8, 10.8, TOPD + 2.58, 0.18, 22, WHITE, GREEN, WHITE, 1);
  ellStack(kit, 4.0, TOPD, 3.1, 0.8, 0.62, [[0, 0.85, WHITE], [0.45, 0.62, GREEN, 0.012], [0.66, 0.72, RED, 0.012], [0.85, 1, BLACK, 0.02]]);
  slab(kit, () => 3.9, -17.6, -5.4, TOPD + 2.45, 0.1, 2, WHITE, GREEN, WHITE);
  for (const x of [-17.2, -13.4, -9.6, -5.8]) for (const s of [-1, 1]) kit.add('paint', rod(V(x, TOPD, s * 3.7), V(x, TOPD + 2.36, s * 3.7), 0.045, 5, true), WHITE);
  kit.add('paint', rod(V(7.2, TOPD + 2.58, 0), V(7.2, TOPD + 5.6, 0), 0.06, 6), WHITE); kit.add('paint', rod(V(7.2, TOPD + 4.6, -1.3), V(7.2, TOPD + 4.6, 1.3), 0.035, 5), WHITE);
  kit.add('paint', box(0.2, 0.12, 1.5), WHITE, M(8.6, TOPD + 3.02, 0)); kit.add('paint', cyl(0.1, 0.1, 0.4, 8), WHITE, M(8.6, TOPD + 2.78, 0));
  kit.add('paint', rod(V(-19.7, MAIN, 0), V(-20.3, MAIN + 2.6, 0), 0.035, 5), WHITE);                                                              // ensign staff and a house flag
  for (const [u, c] of [[X_, GREEN], [NX_, GREEN]]) kit.add('paint', plate(V(-20.75, MAIN + 2.2, 0), u, V(-0.22, 0.975, 0), 0.9, 0.6), c);
  // foredeck and aft deck fittings
  kit.add('paint', rbox(0.9, 0.5, 1.2, 0.08), GREY, M(16.2, MAIN + 0.25, 0)); for (const s of [-1, 1]) kit.add('paint', cyl(0.12, 0.14, 0.5, 8), BLACK, M(14.5, MAIN + 0.25, s * 1.6));
  for (const s of [-1, 1]) rail(kit, railRun((x) => P.plan(x) - 0.15, CA, -19.85, MAIN, 2, s), 1.05);
  rail(kit, [V(-19.85, MAIN, -(P.plan(-19.85) - 0.15)), V(-19.85, MAIN, 0), V(-19.85, MAIN, P.plan(-19.85) - 0.15)], 1.05);
  for (const s of [-1, 1]) rail(kit, railRun((x) => P.plan(x) - 0.2, CF, 13.6, MAIN, 2, s), 1.0);
  for (const z of [-1.4, 1.4]) propeller(kit, -17.2, -1.45, z, 0.5); const rud = rudder(mats.paint, -18.8, -0.55, 1.5, 1.1);
  const hullTex = shipBands('tour' + WHITE, kit.sideMap, [[-9, 99, WHITE], [-9, 1.7, GREEN], [-9, 1.14, RED], [-9, 1.02, WHITE], [-9, 0.24, BLACK], [-9, 0.1, 0x74231b]]);
  const S = signs('tour-signs', [{ text: 'CIRCULAR LOGIC', font: SANS, color: css(GREEN), px: 140, spacing: 10 }, { text: 'SIGHTSEEING CRUISES', font: SANS, color: css(RED), px: 90, spacing: 6 }]);
  nameOn(dk, S, 0, (x) => cz(x), -4.5, MAIN + 0.14, 0.66, 8); nameOn(dk, S, 1, (x) => cz(x), 4.6, MAIN + 0.2, 0.4, 6); nameOn(dk, S, 0, P.zAt, 16.2, 1.95, 0.42, 10, 0.035);
  const { object, windows } = assemble('tour', kit, wk, dk, hullTex, S, mats); object.add(rud);
  const nl = navLights({ size: 0.28, port: [7.5, TOPD + 2.72, -2.45], starboard: [7.5, TOPD + 2.72, 2.45], stern: [TA + 0.15, TOPD + 1.2, 0] }); object.add(nl.port, nl.starboard, nl.stern);
  const spec = {
    kind: 'tour', name: 'Circular Logic', len: 40, beam: 9.2, draft: D, freeboard: MAIN, mass: 180e3,
    hull: waterlinePoly(P, 9), float: [[17, 0], [8, -3.2], [8, 3.2], [-12, -3.4], [-12, 3.4], [-19, 0]],
    helm: [8.0, TOPD, 0], helmPose: 'stand', eye: [8.2, TOPD + 1.7, 0], props: [[-17.2, -1.45, -1.4], [-17.2, -1.45, 1.4]], bow: [20, 0, 0],
    board: [[-18.5, MAIN, -3.5], [-18.5, MAIN, 3.5]],
    decks: [{ x0: -18, x1: 5, z0: -3.6, z1: 3.6, y: TOPD }, { x0: -19.8, x1: -17.1, z0: -3.6, z1: 3.6, y: MAIN }, { x0: 11.2, x1: 16.5, z0: -2, z1: 2, y: MAIN }, { x0: 5.5, x1: 9.5, z0: -2, z1: 2, y: TOPD }],
  };
  return { object, spec, parts: { engines: [rud], wheel: null, lights: { ...nl, cabin: [windows] } } };
}

// ================================================================ entry
const BUILD = { speedboat, ferry, tug, tour };
export function makeBoat(kind, opts = {}) {
  const f = BUILD[kind]; if (!f) throw new Error('boats.js: unknown kind ' + kind);
  const out = f(opts); out.object.userData.boat = out.spec; return out;
}
