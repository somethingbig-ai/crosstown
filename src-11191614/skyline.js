// skyline.js (facades lane, Nov 17; BRIEF: "the far city: keep the skyline whole at every distance"): from the air the city beyond the map's own box went
// flat a kilometre out (far.glb is thinned by height with distance and stops 2.3 km from the core box), and Lower Manhattan was not there at all.
// assets/far/skyline.json (lanes/facades/skyline/tools/mkskyline.mjs) holds every building of 20 m and up of all the built areas as plain boxes: height, base,
// outline. Here, once the game is ready, the boxes that stand OUTSIDE what this map draws itself (no building of the map within 120 m) are built into a few
// merged meshes: plain walls in a few masonry tones with a faint window grid, in the scene's light and haze, pushed behind far.glb in depth so that where
// far.glb has the same tower, its textured one shows. No shadows, no collision. ?skyline=0 = off.
import * as THREE from 'three';
export async function addSkyline(g) {
  const t0 = performance.now(), city = g.city, w = g.world; if (!city || !city.buildings) return null;
  const r = await fetch('assets/far/skyline-2.json.gz'); if (!r.ok) throw new Error('skyline-2.json.gz ' + r.status);     /* -2 (Nov 17): the uptown map's buildings are in it too, so the city also runs on NORTH of a map that ends at 59th St; a new name so no browser keeps the first file */ const J = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json(), d = J.d, U = J.unit || 0.5;     /* packed, unpacked in the page, as tiles.js does */
  // what the map draws itself: 120 m cells that hold one of its buildings
  const C = 120, own = new Set(); for (const b of city.buildings) if (b.poly && b.poly.length) own.add(Math.floor(b.poly[0][0] / C) + ',' + Math.floor(b.poly[0][1] / C));
  const near = (x, y) => { const i = Math.floor(x / C), j = Math.floor(y / C); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (own.has((i + a) + ',' + (j + b))) return true; return false; };
  // r3 (the blind critic: 'clusters stand on water', 'far towers darker and sharper than the hazy nearer city'): no box where THIS map draws water (its own water outlines:
  // on the ordinary map the far shores are water), and each box takes haze for its distance from the map's own buildings (the scene's fog then adds the camera's own).
  const inP = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const waters = (Array.isArray(city.water) ? city.water : []).filter((q) => q && q.poly && q.poly.length > 2).map((q) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of q.poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return { poly: q.poly, x0, y0, x1, y1 }; });
  const wet = (x, y) => waters.some((q) => x > q.x0 && x < q.x1 && y > q.y0 && y < q.y1 && inP(q.poly, x, y));
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9; for (const b of city.buildings) if (b.poly && b.poly.length) { const p = b.poly[0]; bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
  let nWet = 0;
  const CH = 2400 /* -2: was 900; fewer, larger meshes (CHIEF 14:33: the slow frame is draw calls) */, chunks = new Map(), TONES = [[0.30, 0.17, 0.13], [0.36, 0.22, 0.17], [0.42, 0.36, 0.28], [0.46, 0.44, 0.40], [0.38, 0.38, 0.39], [0.33, 0.30, 0.27]];
  let n = 0, tris = 0; const hash = (a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
  for (let k = 0; k < d.length;) { const h = d[k], base = d[k + 1], m = d[k + 2], o = k + 3; k = o + m * 2;
    let cx = 0, cy = 0, area = 0; for (let i = 0; i < m; i++) { cx += d[o + i * 2]; cy += d[o + i * 2 + 1]; const j = (i + 1) % m; area += d[o + i * 2] * d[o + j * 2 + 1] - d[o + j * 2] * d[o + i * 2 + 1]; } cx = cx / m * U; cy = cy / m * U;
    if (near(cx, cy)) continue; if (wet(cx, cy)) { nWet++; continue; }
    const dEdge = Math.hypot(Math.max(bx0 - cx, 0, cx - bx1), Math.max(by0 - cy, 0, cy - by1)), hz = Math.min(0.6, 1 - Math.exp(-dEdge * 0.0003));     /* -2: less baked haze (was 0.00042, uncapped): with the uptown boxes the far blocks read as white cut-outs against the sky; the scene's fog does the rest */
    const key = String(Math.floor((Math.atan2(cy - (by0 + by1) / 2, cx - (bx0 + bx1) / 2) + Math.PI) / (Math.PI / 2)) % 4);     /* -3 (light's draw count, Nov 17 17:45: the far skyline was 21 draws at the spawn, never culled): FOUR meshes, one per quarter of the compass round the map, so a view draws one or two */ let c = chunks.get(key); if (!c) chunks.set(key, (c = { p: [], nm: [], col: [], uv: [], ix: [] }));
    const ccw = area > 0, pts = []; for (let i = 0; i < m; i++) { const q = ccw ? i : m - 1 - i; pts.push([d[o + q * 2] * U, d[o + q * 2 + 1] * U]); }
    const hv = hash(cx, cy), tone = h > 150 && hv < 0.5 ? [0.20, 0.24, 0.28] : TONES[Math.floor(hash(cy, cx) * TONES.length) % TONES.length].map((v, i, a) => (v * 0.65 + (a[0] + a[1] + a[2]) / 3 * 0.35) * 0.8), sh = 0.85 + 0.3 * hv,     /* r2: calmer and darker than the first try, which stood out salmon and cream against the map's own roofs */ y0 = base > 0 ? base : -1.5; for (let q = 0; q < 3; q++) tone[q] = tone[q] * (1 - hz) + [0.50, 0.55, 0.64][q] * hz / sh;
    let run = hv * 7;
    for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey); if (len < 0.3) continue; const nx = ey / len, ny = -ex / len, v0 = c.p.length / 3;     /* outward for a counter-clockwise outline; scene z = -north */
      c.p.push(a[0], y0, -a[1], b[0], y0, -b[1], b[0], h, -b[1], a[0], h, -a[1]); for (let q = 0; q < 4; q++) { c.nm.push(nx, 0, -ny); c.col.push(tone[0] * sh, tone[1] * sh, tone[2] * sh); }
      c.uv.push(run / 3.3, y0 / 3.5, (run + len) / 3.3, y0 / 3.5, (run + len) / 3.3, h / 3.5, run / 3.3, h / 3.5); run += len; c.ix.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); tris += 2; }     /* front face outward (scene z = -north turns the outline's sense) */
    const v0 = c.p.length / 3, tr = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q[0], q[1])), []); for (const q of pts) { c.p.push(q[0], h, -q[1]); c.nm.push(0, 1, 0); c.col.push(0.20 * sh * (1 - hz) + 0.50 * hz, 0.20 * sh * (1 - hz) + 0.55 * hz, 0.21 * sh * (1 - hz) + 0.64 * hz); c.uv.push(0.03, 0.03); }
    for (const t of tr) { c.ix.push(v0 + t[0], v0 + t[1], v0 + t[2]); tris++; } n++; }
  if (!n) { console.log('[skyline] nothing stands outside this map'); return { meshes: [], n: 0, tris: 0 }; }
  // a faint window grid: one bay by one storey, the corner texel plain wall (roofs use it)
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); x.fillStyle = 'rgb(88,96,108)'; x.fillRect(20, 16, 26, 30);
  const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 16 });
  // -4, night (the critic: 'unlit blue-grey lumps'): one window in seven is lit, from a 16 x 16 sheet of windows laid over the same bays; its strength follows the game's night (game.night.n)
  { const ev = document.createElement('canvas'); ev.width = ev.height = 256; const e = ev.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256); let sd = 7; const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { if (rnd() > 0.10) continue; const w = rnd(); e.fillStyle = w < 0.35 ? 'rgb(255,222,170)' : w < 0.7 ? 'rgb(240,238,228)' : 'rgb(200,220,255)';     /* -4b (the blind critic: the far lights were 'warmer and brighter than the nearer city's'): one in ten, a third warm, a third white, a third cool */ e.globalAlpha = 0.5 + 0.5 * rnd(); e.fillRect(i * 16 + 4.5, j * 16 + 3.5, 7, 8.5); } e.globalAlpha = 1;
    const et = new THREE.CanvasTexture(ev); et.wrapS = et.wrapT = THREE.RepeatWrapping; et.repeat.set(1 / 16, 1 / 16); et.colorSpace = THREE.SRGBColorSpace; mat.emissiveMap = et; mat.emissive.setRGB(1, 1, 1); mat.emissiveIntensity = 0; }
  const root = new THREE.Group(); root.name = 'far_skyline'; const meshes = [];
  for (const c of chunks.values()) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(c.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(c.nm, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2)); geo.setIndex(c.ix); geo.computeBoundingSphere();
    const me = new THREE.Mesh(geo, mat); me.castShadow = false; me.receiveShadow = false; me.matrixAutoUpdate = false; me.updateMatrix(); root.add(me); meshes.push(me); }
  const lit = () => { const nt = g.night && isFinite(g.night.n) ? g.night.n : 0, k = nt * 0.75;     /* -4b: was 1.6 */ if (Math.abs(mat.emissiveIntensity - k) > 0.01) mat.emissiveIntensity = k; }; for (const me of meshes) me.onBeforeRender = lit;     /* whichever mesh is drawn first sets the lit windows for all (one material) */
  w.scene.add(root); const S = { meshes, root, n, tris, nWet, ms: Math.round(performance.now() - t0) };
  console.log('[skyline] ' + n + ' far buildings outside this map (' + nWet + ' left out: this map draws water there), ' + tris + ' triangles in ' + meshes.length + ' meshes, ' + S.ms + ' ms'); return S;
}
