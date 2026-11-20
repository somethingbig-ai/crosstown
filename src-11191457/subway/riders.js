// subway/riders.js (subway lane, v3 part): PEOPLE underground. install(game, S) from subway.js (?subx=riders while it is tested).
//  - WHO: the city crowd's own figures (game/src/crowd: crowd.glb, mocap clips baked into one float texture). When the game's crowd is loaded its
//    baked texture, meshes (full, clustered, far) and maps are SHARED (no second copy on the GPU, the crowd's own meshes are not touched); when it is
//    not (?crowd=none, or a dev page) a small cast of 12 is loaded and baked here with the crowd's own bake(). Either way they are drawn by a few
//    instanced meshes of our own on layer S.LAYER, with an UNLIT material: the light is a number per person (the station's lamps where he stands,
//    worked out as build.js does for the walls; the car's lamps aboard) times a soft top-light term in the vertex shader. No real-time lights.
//  - WHERE: waiting on the platforms (by the edge strip, by the columns, in the middle, talking in pairs, seated on the benches), walking between the
//    street stairs and the platforms (ways from nav.js, a handful per station, found once and shared with a keep-right offset), and aboard every
//    train that is in sight (train.js seats / stand places). When doors open some step out and go up to the street, some of those waiting step in.
//  - COST: only the unit the player is in is stepped and drawn; standing and seated people cost nothing but their instance (16 floats); three levels
//    of detail by distance; nobody on the other level or behind the camera is drawn.
// Everything lives with the station unit (made when the player first comes down or rides in, thrown away on 'drop'). Nothing of the game is edited.
// nav.js's findPath, the same search step for step (0.6 m steps, each tested with walk.free half way and at its end), as a generator: it yields every few nodes so
// that a way is found over several frames (a way is 1 to 90 ms of work on a laptop, one that does not exist far more: too long for one frame of play).
function* findWay(walk, from, to, o = {}) {
  const C = o.cell || 0.6, R = o.r || 0.3, MAX = o.max || 40000, WH = o.greed || 1.6, key = (x, y, z) => Math.round(x / C) + ',' + Math.round(y / C) + ',' + Math.round(z / 0.6);
  const f0 = walk.floorAt(from.x, from.y, from.z, 0.6); if (!f0) return null;
  const h = (x, y, z) => (Math.hypot(x - to.x, y - to.y) + Math.abs(z - to.z) * 2.2) * WH, DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];
  const start = { x: from.x, y: from.y, z: from.z, g: 0, f: h(from.x, from.y, from.z), prev: null }, open = [start], seen = new Map([[key(start.x, start.y, start.z), 0]]), p = { x: 0, y: 0, z: 0 }; let n = 0, best = start;
  const push = (nd) => { let i = open.length; open.push(nd); while (i > 0) { const j = (i - 1) >> 1; if (open[j].f <= nd.f) break; open[i] = open[j]; i = j; } open[i] = nd; };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { let i = 0; for (;;) { let j = 2 * i + 1; if (j >= open.length) break; if (j + 1 < open.length && open[j + 1].f < open[j].f) j++; if (open[j].f >= last.f) break; open[i] = open[j]; i = j; } open[i] = last; } return top; };
  const zOf = (f, x, y) => { const u = (x - f.x) * f.ca + (y - f.y) * f.sa; return f.z0 === f.z1 ? f.z0 : f.z0 + (f.z1 - f.z0) * Math.min(1, Math.max(0, u / f.l + 0.5)); }, trace = (nd) => { const out = []; for (let q = nd; q; q = q.prev) out.push([q.x, q.y, q.z]); out.reverse(); return out; };
  while (open.length && n++ < MAX) { if ((n & 3) === 0) yield; const c = pop(); if (c.g > (seen.get(key(c.x, c.y, c.z)) ?? 1e9) + 1e-6) continue;
    if (Math.hypot(c.x - to.x, c.y - to.y) < (o.near || 0.7) && Math.abs(c.z - to.z) < 0.6) { best = c; break; } if (c.f - c.g < best.f - best.g) best = c;
    for (const [dx, dy] of DIRS) { const mx = c.x + dx * C / 2, my = c.y + dy * C / 2, fm = walk.free(mx, my, c.z, R); if (!fm) continue; const zm = zOf(fm, mx, my); p.x = c.x + dx * C; p.y = c.y + dy * C; const fl = walk.free(p.x, p.y, zm, R); if (!fl) continue; p.z = zOf(fl, p.x, p.y);
      const g = c.g + C + Math.abs(p.z - c.z), k = key(p.x, p.y, p.z); if (g >= (seen.get(k) ?? 1e9) - 1e-6) continue; seen.set(k, g); push({ x: p.x, y: p.y, z: p.z, g, f: g + h(p.x, p.y, p.z), prev: c }); } }
  if (Math.hypot(best.x - to.x, best.y - to.y) > (o.near || 0.7) + 0.01 || Math.abs(best.z - to.z) >= 0.6) return null; return trace(best);
}

const TAU = Math.PI * 2, STRIDE = 16, NEAR_R = 6.5, MID_R = 24, DRAW_R = 78, RB = 0.26, DAY = 1.5;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const WALKS = ['Walk', 'Walk2', 'Walk3', 'Walk4', 'Walk6', 'Walk7', 'Walk8'], STANDS = ['Idle', 'Idle', 'Idle', 'IdleShift', 'IdleShift', 'IdleShift', 'Wait', 'Wait', 'PhoneLook', 'PhoneLook', 'PhoneStand'], SITS = ['SitIdle', 'SitIdle', 'SitTalk'];
const CLIPS = [...new Set([...WALKS, ...STANDS, ...SITS, 'TalkA', 'TalkB', 'WalkSlow'])];
const rng = (s) => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const srgb = (c) => (Math.round(clamp(c[0], 0, 1) * 255) << 16) | (Math.round(clamp(c[1], 0, 1) * 255) << 8) | Math.round(clamp(c[2], 0, 1) * 255);
// under the warm lamps a pink, cream or tan garment reads as bare skin (a pink jacket was taken for a naked man on a still): those palette colours are not worn below
const SKINLIKE = (c) => c[0] > 0.5 && c[0] >= c[1] && c[1] >= c[2] && c[0] - c[2] > 0.12 && c[0] - c[2] < 0.45;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function install(game, S) { if (S.riders) return S.riders; const R = new Riders(game, S); S.riders = R;
  // subway.js asks this before F sits him down: a seat a rider is in is not his to take
  S.seatTaken = (t, q) => { try { const P = R.pops.get(t.u), O = P && P.occ.get(t), i = t.train.seats.indexOf(q); return !!(O && i >= 0 && O.seat[i]); } catch (e) { return false; } }; return R; }

// ================================================================== the cast: clips + characters (+ what to draw them with)
// from the game's crowd, as it stands in memory
function castFromCrowd(game) {
  const cr = game.crowd, R = cr.render, B = R.baked, cast = R.cast, meta = cast.sim, farOf = (cr.sim && cr.sim.farOf) || [];
  const clips = {}; for (const c of B.clips) if (!c.missing) clips[c.name] = Object.assign({}, meta.clips[c.name] || {}, { name: c.name, x0: c.x0, F: c.F, dur: c.dur });
  const mids = (ci) => R.chars[ci].mid.meshes.map((m) => m.geometry), fars = (ci) => (R.chars[ci].far ? R.chars[ci].far.meshes.map((m) => m.geometry) : []);
  const chars = cast.chars.map((ch, ci) => { const m = meta.characters[ci] || {}, mg = mids(ci), fi = farOf[ci] === undefined ? ci : farOf[ci], fch = cast.chars[fi], fg = fars(ci); let k = 0, kf = 0;
    const parts = ch.parts.map((p) => ({ geo: p.geometry, map: p.material.map, mask: p.mask, alpha: !!p.alphaTest, mid: p.far === false ? null : mg[k++] || null }));
    const far = fg.length ? fch.parts.filter((p) => p.far !== false).map((p) => ({ geo: fg[kf++], map: p.material.map, mask: p.mask, alpha: !!p.alphaTest })).filter((p) => p.geo) : null;
    return { name: ch.name, height: ch.height || 1.75, leg: m.leg, female: !!m.female, top: m.top, bottom: m.bottom, hair: m.hair, row: ch.rowBase, parts, far, farRow: R.chars[ci].farRow, farK: R.chars[ci].farK || 1 }; });
  return { kind: 'game crowd (' + cast.kind + ')', tex: B.tex, W: B.W, H: B.H, clips, chars };
}
// our own small copy (the crowd is off, or there is no game): the same file, the crowd's own bake and clustering
async function castOwn(THREE, n = 12) {
  const [{ GLTFLoader }, { bake }, { clusterGeometry }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('../crowd/render.js'), import('../crowd/lod.js')]);
  const A = 'assets/crowd/', meta = await (await fetch(A + 'crowd.json')).json(); let gltf;
  try { const r = await fetch(A + 'crowd.glb.gz'); if (!r.ok || !self.DecompressionStream) throw new Error('no packed file'); gltf = await new GLTFLoader().parseAsync(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), A); }
  catch (e) { gltf = await new GLTFLoader().loadAsync(A + 'crowd.glb'); }
  gltf.scene.updateMatrixWorld(true);
  const all = meta.characters.filter((c) => (c.height || 1.75) > 1.5), pick = []; for (const fem of [true, false]) { const L = all.filter((c) => !!c.female === fem), m = Math.min(L.length, n >> 1); for (let i = 0; i < m; i++) pick.push(L[Math.floor(((i + 0.5) / m) * L.length)]); }
  const src = [];
  for (const c of pick) { const root = gltf.scene.getObjectByName(c.name); if (!root) continue; const sm = []; root.traverse((o) => { if (o.isSkinnedMesh) sm.push(o); }); if (!sm.length) continue;
    src.push({ name: c.name, root, height: c.height || 1.75, skeleton: sm[0].skeleton, bind: sm[0].bindMatrix.clone(), meta: c, meshes: sm }); }
  if (!src.length) throw new Error('crowd.glb has no characters');
  const have = new Set(gltf.animations.map((a) => a.name)), names = CLIPS.filter((k) => have.has(k) && meta.clips[k]), mc = {}; for (const k of names) mc[k] = meta.clips[k];
  const B = bake(null, { chars: src, accs: [], animations: gltf.animations, sim: { clips: mc } }, names, 30);
  const clips = {}; for (const c of B.clips) if (!c.missing) clips[c.name] = Object.assign({}, mc[c.name], { name: c.name, x0: c.x0, F: c.F, dur: c.dur });
  const chars = src.map((ch) => { const parts = ch.meshes.map((m) => { if (m.material.map) m.material.map.anisotropy = 4; return { geo: m.geometry, map: m.material.map, mask: true, alpha: true, mid: clusterGeometry(m.geometry, 0.04) }; });
    return { name: ch.name, height: ch.height, leg: ch.meta.leg, female: !!ch.meta.female, top: ch.meta.top, bottom: ch.meta.bottom, hair: ch.meta.hair, row: ch.rowBase, parts, far: ch.meshes.map((m) => ({ geo: clusterGeometry(m.geometry, 0.085), map: m.material.map, mask: true, alpha: true })), farRow: ch.rowBase, farK: 1 }; });
  return { kind: 'own copy of crowd.glb (' + chars.length + ' figures, baked in ' + B.ms + ' ms)', tex: B.tex, W: B.W, H: B.H, clips, chars, own: true };
}

// ================================================================== drawing: instanced, skinned from the baked texture, unlit
const VERT = /* glsl */`
  attribute vec4 aPos; attribute vec4 aAnim; attribute vec4 aXf; attribute vec4 aXg; attribute vec4 skinIndex; attribute vec4 skinWeight;
  #ifdef R_MASK
    attribute vec4 aMask;
  #endif
  uniform sampler2D tAnim; uniform vec2 uAnimInv; uniform vec3 uMask; uniform vec3 uLamp;
  varying vec2 vUv; varying vec3 vCol;
  void rRows(float bone, float u, float wt, inout vec4 r0, inout vec4 r1, inout vec4 r2) { float v = (aAnim.w + bone * 3.0 + 0.5) * uAnimInv.y;
    r0 += wt * textureLod(tAnim, vec2(u, v), 0.0); r1 += wt * textureLod(tAnim, vec2(u, v + uAnimInv.y), 0.0); r2 += wt * textureLod(tAnim, vec2(u, v + 2.0 * uAnimInv.y), 0.0); }
  void rClip(float u, out vec4 r0, out vec4 r1, out vec4 r2) { r0 = vec4(0.0); r1 = vec4(0.0); r2 = vec4(0.0);
    #if R_BONES == 1
      rRows(skinIndex.x, u, 1.0, r0, r1, r2);
    #elif R_BONES == 2
      float ws = skinWeight.x + skinWeight.y; rRows(skinIndex.x, u, skinWeight.x / ws, r0, r1, r2); if (skinWeight.y > 0.0) rRows(skinIndex.y, u, skinWeight.y / ws, r0, r1, r2);
    #else
      rRows(skinIndex.x, u, skinWeight.x, r0, r1, r2); if (skinWeight.y > 0.0) rRows(skinIndex.y, u, skinWeight.y, r0, r1, r2);
      if (skinWeight.z > 0.0) rRows(skinIndex.z, u, skinWeight.z, r0, r1, r2); if (skinWeight.w > 0.0) rRows(skinIndex.w, u, skinWeight.w, r0, r1, r2);
      float ws = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w; r0 /= ws; r1 /= ws; r2 /= ws;
    #endif
  }
  vec3 rTint(float f) { float r = floor(f / 65536.0), g = floor((f - r * 65536.0) / 256.0), b = f - r * 65536.0 - g * 256.0; return pow(vec3(r, g, b) / 255.0, vec3(2.2)); }
  void main() {
    vec4 r0, r1, r2; rClip(aAnim.x, r0, r1, r2);
    if (aAnim.z > 0.004) { vec4 s0, s1, s2; rClip(aAnim.y, s0, s1, s2); r0 = mix(r0, s0, aAnim.z); r1 = mix(r1, s1, aAnim.z); r2 = mix(r2, s2, aAnim.z); }
    vec4 p = vec4(position, 1.0); vec3 q = vec3(dot(r0, p), dot(r1, p), dot(r2, p)), n = vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
    float c = cos(aPos.w), s = sin(aPos.w);
    vec3 wp = vec3(c * q.x + s * q.z, q.y, -s * q.x + c * q.z) * aXf.x + aPos.xyz, wn = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
    #ifdef R_MASK
      vec3 m = aMask.rgb; float ao = clamp(aMask.a, 0.0, 1.0);
    #else
      vec3 m = uMask; float ao = 1.0;
    #endif
    vec3 tn = mix(vec3(1.0), rTint(aXf.z), m.r) * mix(vec3(1.0), rTint(aXf.w), m.g) * mix(vec3(1.0), rTint(aXg.x), m.b);
    // the lamps are overhead: what faces up is lit most, the legs a little less than the shoulders, the cast's own baked occlusion on all of it
    float sh = (0.44 + 0.56 * (wn.y * 0.5 + 0.5)) * mix(0.66, 1.0, smoothstep(0.0, 1.3, q.y)) * mix(1.0, ao, 0.8);
    vCol = tn * uLamp * (aXf.y * sh); vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map; varying vec2 vUv; varying vec3 vCol;
  void main() { vec4 t = texture2D(map, vUv);
    #ifdef R_ALPHA
      if (t.a < 0.4) discard;
    #endif
    gl_FragColor = vec4(t.rgb * vCol, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

class Draw {
  constructor(THREE, cast, used, layer, gain) {
    this.T = THREE; this.cast = cast; this.group = new THREE.Group(); this.group.name = 'subway_riders'; this.sets = []; this.mats = new Map(); this.bands = [];
    this.U = { tAnim: { value: cast.tex }, uAnimInv: { value: new THREE.Vector2(1 / cast.W, 1 / cast.H) }, uLamp: { value: new THREE.Vector3(1.0 * gain, 0.965 * gain, 0.88 * gain) } };
    const farBand = new Map();      // far bodies are shared by several characters (the crowd's stand-ins)
    this.chars = used.map((ci) => { const ch = cast.chars[ci], near = this.band(ch.parts.map((p) => ({ geo: p.geo, map: p.map, mask: p.mask, alpha: p.alpha })), 4, 40), midP = ch.parts.filter((p) => p.mid).map((p) => ({ geo: p.mid, map: p.map, mask: p.mask, alpha: p.alpha }));
      const mid = midP.length ? this.band(midP, 2, 110) : near; let far = mid;
      if (ch.far && ch.far.length) { const key = ch.far[0].geo; far = farBand.get(key); if (!far) farBand.set(key, (far = this.band(ch.far, 1, 220))); }
      return { ch, near, mid, far }; });
    for (const b of this.bands) for (const m of b.meshes) { m.layers.set(layer); this.group.add(m); }
    this.stats = { drawn: 0, near: 0, mid: 0, far: 0, calls: 0, tris: 0, dropped: 0 };
  }
  mat(p, bones) { const T = this.T, hasMask = p.mask === true && !!(p.geo.attributes.aMask || p.geo.attributes.color), key = (p.map ? p.map.uuid : '-') + '|' + bones + '|' + (hasMask ? 'm' : (p.mask || [0, 0, 0]).join(',')) + '|' + (p.alpha ? 'a' : '');
    let m = this.mats.get(key); if (m) return m; const defines = { R_BONES: bones }; if (hasMask) defines.R_MASK = 1; if (p.alpha) defines.R_ALPHA = 1;
    m = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, defines, uniforms: { tAnim: this.U.tAnim, uAnimInv: this.U.uAnimInv, uLamp: this.U.uLamp, uMask: { value: new T.Vector3(...(Array.isArray(p.mask) ? p.mask : [0, 0, 0])) }, map: { value: p.map || null } }, side: p.alpha ? T.DoubleSide : T.FrontSide, fog: false });
    m.name = 'riders'; this.mats.set(key, m); return m; }
  band(parts, bones, cap) { const T = this.T, arr = new Float32Array(cap * STRIDE), ib = new T.InstancedInterleavedBuffer(arr, STRIDE, 1); ib.setUsage(T.DynamicDrawUsage); const b = { arr, ib, cap, n: 0, meshes: [], tris: 0 };
    for (const p of parts) { const g = new T.InstancedBufferGeometry(), s = p.geo; g.setIndex(s.index); for (const n of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (s.attributes[n]) g.setAttribute(n, s.attributes[n]);
      const mk = s.attributes.aMask || s.attributes.color; if (mk && p.mask === true) g.setAttribute('aMask', mk);
      g.setAttribute('aPos', new T.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('aAnim', new T.InterleavedBufferAttribute(ib, 4, 4)); g.setAttribute('aXf', new T.InterleavedBufferAttribute(ib, 4, 8)); g.setAttribute('aXg', new T.InterleavedBufferAttribute(ib, 4, 12));
      g.instanceCount = 0; g.boundingSphere = new T.Sphere(new T.Vector3(), 1e5);
      const me = new T.Mesh(g, this.mat(p, bones)); me.frustumCulled = false; me.matrixAutoUpdate = false; me.visible = false; me.castShadow = false; me.receiveShadow = false; me.name = 'riders'; b.meshes.push(me); b.tris += s.index.count / 3; }
    this.bands.push(b); return b; }
  begin() { for (const b of this.bands) b.n = 0; const s = this.stats; s.near = s.mid = s.far = s.dropped = 0; }
  // one figure: map x, y, feet height z, heading, the clips' texture columns and blend, the character, its size, light and colours
  put(k, band, x, y, z, h, uA, uB, blend, scale, light, tint) { const c = this.chars[k], b = band === 0 ? c.near : band === 1 ? c.mid : c.far, far = b === c.far && b !== c.mid; if (b.n >= b.cap) { this.stats.dropped++; return; }
    const A = b.arr, o = b.n++ * STRIDE; A[o] = x; A[o + 1] = z; A[o + 2] = -y; A[o + 3] = h; A[o + 4] = uA; A[o + 5] = uB; A[o + 6] = blend; A[o + 7] = far ? c.ch.farRow : c.ch.row; A[o + 8] = far ? scale * c.ch.farK : scale; A[o + 9] = light; A[o + 10] = tint[0]; A[o + 11] = tint[1]; A[o + 12] = tint[2];
    if (band === 0) this.stats.near++; else if (band === 1) this.stats.mid++; else this.stats.far++; }
  end() { const s = this.stats; s.calls = 0; s.tris = 0; for (const b of this.bands) { const n = b.n; for (const me of b.meshes) { me.visible = n > 0; me.geometry.instanceCount = n; } if (n) { b.ib.clearUpdateRanges(); b.ib.addUpdateRange(0, n * STRIDE); b.ib.needsUpdate = true; s.calls += b.meshes.length; s.tris += n * b.tris; } } s.drawn = s.near + s.mid + s.far; }
  dispose() { this.group.removeFromParent();
    // the vertex data belongs to the crowd (or to our cast, which is kept): only our instance buffers and programs go
    for (const b of this.bands) for (const me of b.meshes) { const g = me.geometry; for (const n of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'aMask']) g.deleteAttribute(n); g.setIndex(null); g.dispose(); }
    for (const m of this.mats.values()) m.dispose(); }
}

// ================================================================== one station's people
class Pop {
  constructor(R, u) { this.R = R; this.S = R.S; this.u = u; this.st = u.st; this.walk = u.walk; this.meta = R.S.meta; this.rand = rng(977 + (u.st.plen | 0) * 31 + R.pops.size * 7919 + ((R.time * 10) | 0));
    this.agents = []; this.occ = new Map(); this.doors = new Map(); this.plats = []; this.paths = []; this.pathQ = []; this.wayQ = []; this.search = null; this.todo = []; this.spawnT = 1; this.turnT = 4; this.age = 0; this.ready = false; this.seeded = false; this.gen = this.build(); this.lost = 0; this.rescues = 0; this.rescueT = 0;
    this.count = { boarded: 0, alighted: 0, arrived: 0, left: 0 }; }
  pick(a) { return a[Math.floor(this.rand() * a.length) % a.length]; }

  // ---------------------------------------------------------------- setup (spread over frames)
  *build() { const st = this.st, wk = this.walk, W = this.S.Walk, meta = this.meta, zP = meta.zP, r = this.rand, sc = this.R.scale;
    const THINGS = []; for (const t of st.things || []) { if (t.xy && t.x === undefined) for (let i = 0; i < t.xy.length; i += 2) THINGS.push({ k: t.k, a: t.a, z: t.z, h: t.h, lvl: t.lvl, x: t.xy[i], y: t.xy[i + 1] }); else THINGS.push(t); }      // (packed since v3, as build.js spreads them)
    // the lamps, as build.js lit the walls with them
    const LC = 6, lg = (this.lg = new Map()), addLamp = (x, y, z, I, reach) => { const l = { x, y, z, I, reach }; for (let i = Math.floor((x - 9) / LC); i <= Math.floor((x + 9) / LC); i++) for (let j = Math.floor((y - 9) / LC); j <= Math.floor((y + 9) / LC); j++) { const k = i * 100003 + j; let a = lg.get(k); if (!a) lg.set(k, (a = [])); a.push(l); } };
    for (const t of THINGS) if (t.k === 'lamp') addLamp(t.x, t.y, t.z, t.lvl === 'p' ? 1.9 : 1.5, t.lvl === 'p' ? 6.2 : 3.3);
    this.wells = st.floors.filter((f) => f.k === 'street'); for (const f of this.wells) { const d = meta.lOpen + 2.2 - f.l / 2; addLamp(f.x + f.ca * d, f.y + f.sa * d, W.zAt(f, d) + meta.hM - 0.25, 1.1, 3.4); }
    yield;
    // platforms: frame (u along, v across), the lanes that are clear from end to end, columns, benches, the feet of the stairs
    for (const f of st.floors.filter((q) => q.k === 'platform')) { const hw = f.w / 2, hl = f.l / 2, P = { f, i: f.plat, hw, hl, map: (u, v) => [f.x + f.ca * u - f.sa * v, f.y + f.sa * u + f.ca * v], lane: {}, edge: {}, stairs: [], spots: [], n: 0, target: Math.max(4, Math.round(f.l * 0.3 * sc)), tracks: (st.tracks || []).filter((T) => T.plat === f.plat) };
      const full = []; for (let v = -hw + 0.3; v <= hw - 0.299; v += 0.1) { let ok = true; for (let uu = -hl + 1, c = 0; uu < hl - 1 && ok; uu += 0.5) { const [x, y] = P.map(uu, v); if (!wk.free(x, y, zP, 0.3)) ok = false; if (++c % 12 === 0) yield; } if (ok) full.push(Math.round(v * 10) / 10); yield; }
      for (const sg of [-1, 1]) { const L = full.filter((v) => v * sg > 0.25).map((v) => v * sg).sort((a, b) => a - b), runs = []; for (const v of L) { const q = runs[runs.length - 1]; if (q && v - q[1] < 0.15) q[1] = v; else runs.push([v, v]); }
        P.lane[sg] = runs.length ? sg * (runs[0][0] + runs[0][1]) / 2 : null; P.edge[sg] = runs.length ? sg * (runs[runs.length - 1][0] + runs[runs.length - 1][1]) / 2 : null; }
      for (const sg of [-1, 1]) { if (P.lane[sg] === null) P.lane[sg] = P.lane[-sg] ?? sg * hw * 0.45; if (P.edge[sg] === null) P.edge[sg] = P.edge[-sg] ?? sg * (hw - 0.4); }
      const inP = (x, y) => Math.abs(W.u(f, x, y)) <= hl && Math.abs(W.v(f, x, y)) <= hw;
      P.cols = THINGS.filter((t) => t.k === 'col' && t.lvl === 'p' && inP(t.x, t.y)).map((t) => [W.u(f, t.x, t.y), W.v(f, t.x, t.y)]);
      P.benches = THINGS.filter((t) => t.k === 'bench' && inP(t.x, t.y)).map((t) => ({ u: W.u(f, t.x, t.y), v: W.v(f, t.x, t.y), z: t.z }));
      for (const g of st.floors.filter((q) => q.k === 'pstair' && q.plat === f.plat)) { const low = g.z0 < g.z1 ? -1 : 1, d = low * (g.l / 2 + 1.1), ax = g.x + g.ca * d, ay = g.y + g.sa * d, top = -low * (g.l / 2 + 0.8);
        if (inP(ax, ay)) P.stairs.push({ g, x: ax, y: ay, z: zP, u: W.u(f, ax, ay), v: W.v(f, ax, ay), tx: g.x + g.ca * top, ty: g.y + g.sa * top, paths: [], P }); }
      this.plats.push(P); yield; }
    // the ways between the street and the platforms: for the foot of every platform stair, the two open entrances nearest its top
    const ents = (st.ent || []).map((i) => this.S.entrances[i]).filter((e) => e && e.open);
    for (const P of this.plats) for (const s of P.stairs) { const near = ents.slice().sort((a, b) => Math.hypot(a.x - s.tx, a.y - s.ty) - Math.hypot(b.x - s.tx, b.y - s.ty)).slice(0, 2);
      for (const e of near) this.pathQ.push({ s, e, from: { x: e.x + Math.cos(e.h) * 0.4, y: e.y + Math.sin(e.h) * 0.4, z: meta.zWalk - 0.2 }, to: { x: s.x, y: s.y, z: zP } }); }
    for (let i = this.pathQ.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [this.pathQ[i], this.pathQ[j]] = [this.pathQ[j], this.pathQ[i]]; }
    // the trains are made a moment after the station: wait for them (their doors say where nobody should stand)
    while (this.u.trains.length < (st.tracks || []).length && this.age < 6) yield 'wait';
    for (const t of this.u.trains) this.doorsOf(t);
    // places to wait
    for (const P of this.plats) { const f = P.f, want = Math.round(P.target * 1.7), sp = P.spots; let tries = 0;
      const dz = []; for (const t of this.u.trains) if (t.T.plat === P.i) { const D = this.doors.get(t); if (D) for (const d of D.list) dz.push([d.u, Math.sign(d.v)]); }
      while (sp.length < want && tries++ < want * 30) { if (tries % 3 === 0) yield; const q = r(); let uu, v, kind;
        if (q < 0.45) { const sg = r() < 0.5 ? -1 : 1; if (!P.tracks.some((T) => Math.sign(W.v(f, (T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2)) === sg)) continue; uu = (r() * 2 - 1) * (P.hl - 2); v = sg * (P.hw - 0.56 - r() * 0.14); kind = 'edge'; }
        else if (q < 0.8 || !P.cols.length) { uu = (r() * 2 - 1) * (P.hl - 2.5); v = (r() * 2 - 1) * Math.max(0.1, Math.min(Math.abs(P.lane[1]), Math.abs(P.lane[-1])) - 0.65); kind = 'mid'; }
        else { const c = this.pick(P.cols); uu = c[0] + (r() < 0.5 ? -1 : 1) * (0.6 + r() * 0.1); v = c[1] + Math.sign(c[1] || 1) * 0.1; kind = 'col'; }
        if (Math.abs(v - P.lane[1]) < 0.55 || Math.abs(v - P.lane[-1]) < 0.55) continue;
        let bad = false; for (const d of dz) if (d[1] * v > P.hw - 1.6 && Math.abs(d[0] - uu) < 1.35) { bad = true; break; } if (bad) continue;
        for (const s of P.stairs) if (Math.hypot(s.u - uu, s.v - v) < 1.6) { bad = true; break; } if (bad) continue;
        for (const o of sp) if (Math.abs(o.u - uu) < 0.95 && Math.hypot(o.u - uu, o.v - v) < 0.95) { bad = true; break; } if (bad) continue;
        const [x, y] = P.map(uu, v); if (!wk.free(x, y, zP, 0.32)) continue;
        // he faces a track (the nearer edge for those at the edge), now and then looks up the line for the train
        const cand = P.tracks.map((T) => ({ T, v: W.v(f, (T.a[0] + T.b[0]) / 2, (T.a[1] + T.b[1]) / 2) })); let tr = null; if (cand.length) { const same = cand.filter((c) => c.v * v > 0); tr = (Math.abs(v) > 1 && same.length ? same[0] : this.pick(cand)); }
        const sg = tr ? Math.sign(tr.v) : (r() < 0.5 ? -1 : 1), base = f.a + sg * Math.PI / 2, h = tr && r() < 0.22 ? f.a + (tr.T.dir > 0 ? Math.PI : 0) + (r() - 0.5) * 0.7 + (tr.T.dir > 0 ? -1 : 1) * sg * 0.3 : base + (r() - 0.5) * (kind === 'edge' ? 0.9 : 1.6);
        sp.push({ P, u: uu, v, x, y, h, tr: tr && tr.T, kind, who: null }); } }
    yield;
    // the people who are already there when he comes down: waiting, some in pairs, a few seated
    for (const P of this.plats) { const free = P.spots.slice(); for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
      const n0 = Math.max(0, P.target - 3); let k = 0; for (const s of free) { if (k >= n0) break; if (s.who) continue; const a = this.waiter(P, s); k++;
        if (s.kind !== 'col' && r() < 0.16 && this.R.clip('TalkA') && this.R.clip('TalkB')) { const at = this.R.clip('TalkA').partner_at || [0.95, 0, 180], c = Math.cos(a.h), sn = Math.sin(a.h), bx = a.x + c * at[0] - sn * at[1], by = a.y + sn * at[0] + c * at[1];
          if (wk.free(bx, by, zP, 0.3) && !this.agents.some((o) => o !== a && Math.hypot(o.x - bx, o.y - by) < 0.8) && Math.abs(W.v(P.f, bx, by) - P.lane[1]) > 0.5 && Math.abs(W.v(P.f, bx, by) - P.lane[-1]) > 0.5) { const b = this.person(bx, by, zP, a.h + at[2] * Math.PI / 180); b.home = P; b.mode = 'wait'; b.pair = a; a.pair = b; b.stand = this.R.clip('TalkB'); a.stand = this.R.clip('TalkA'); this.setClip(a, a.stand, 0); this.setClip(b, b.stand, 0); a.ph = b.ph = r(); a.blendEnd = b.blendEnd = 0; this.agents.push(b); k++; } }
        if (k % 2 === 0) yield; }
      for (const b of P.benches) for (const du of [-0.6, 0, 0.6]) { if (r() > 0.42) continue; const sg = r() < 0.5 ? -1 : 1, [x, y] = P.map(b.u + du, b.v + sg * 0.07), a = this.person(x, y, b.z, P.f.a + sg * Math.PI / 2); a.mode = 'sit'; this.sit(a, 0.46, true); this.agents.push(a); }
      yield; }
    this.ready = true; }

  // ---------------------------------------------------------------- people
  person(x, y, z, h) { const R = this.R, r = this.rand, k = Math.floor(r() * R.used.length) % R.used.length, ch = R.cast.chars[R.used[k]], pk = (p) => { const q = p && p.length ? (p.cloth || (p.cloth = p.filter((c) => !SKINLIKE(c)))) : null, L = q && q.length ? q : p; return L && L.length ? srgb(L[Math.floor(r() * L.length) % L.length]) : 0xffffff; }, scale = 0.975 + r() * 0.05;
    const a = { born: this.R.time.toFixed(1) + (this.seeded ? '' : ' seed'), k, ch, tint: [pk(ch.top), pk(ch.bottom), pk(ch.hair)], scale, tall: ch.height * scale / 1.78, x, y, z, h, zo: 0, zo0: 0, zoT: -9, clip: null, ph: r(), clipB: null, phB: 0, blendEnd: -9, light: this.lightAt(x, y, z), lightT: r() * 0.5, mode: 'wait', plan: null, car: null, carI: 0, lx: 0, lz: 0, lh: 0, v: 0, vx: 0, vy: 0, stair: false, stuck: 0, blockT: 0, ghostT: 0, stillT: 0, home: null, spot: null, pair: null, place: null };
    a.walk = R.clip(this.pick(WALKS)) || R.anyWalk; a.v0 = a.walk.speed * a.tall * (0.92 + r() * 0.16); a.stand = R.clip(this.pick(STANDS)) || R.anyStand; this.setClip(a, a.stand, 0); return a; }
  waiter(P, s) { const a = this.person(s.x, s.y, this.meta.zP, s.h); a.home = P; a.spot = s; s.who = a; a.mode = 'wait'; P.n++; this.agents.push(a); return a; }
  setClip(a, c, blend = 0.3) { if (!c || a.clip === c) return; if (a.clip && blend > 0) { a.clipB = a.clip; a.phB = this.phase(a, a.clip); a.blendEnd = this.R.time + blend; a.blendLen = blend; } a.clip = c; a.ph = c.speed > 0 ? this.rand() : a.ph - this.R.time / c.dur; }
  phase(a, c) { const p = c.speed > 0 ? a.ph : a.ph + this.R.time / c.dur; return p - Math.floor(p); }
  // seated: the hips come down onto a seat `top` metres above the floor he is on (the cast's own seat rule: crowd/sim.js seated())
  sit(a, top, at0) { const c = this.R.clip(this.pick(SITS)) || this.R.anyStand, hip = a.ch.leg && c.seat_height_leg ? c.seat_height_leg * a.ch.leg * a.scale : (c.seat_height || 0.52) * a.tall; this.setClip(a, c, at0 ? 0 : 0.45); a.zo0 = at0 ? top + 0.085 - hip : a.zo; a.zo = c.seat ? top + 0.085 - hip : 0; a.zoT = at0 ? -9 : this.R.time; }
  unsit(a) { a.zo0 = this.zoff(a); a.zo = 0; a.zoT = this.R.time; }
  zoff(a) { const k = clamp((this.R.time - a.zoT) / 0.45, 0, 1); return a.zo0 + (a.zo - a.zo0) * k * k * (3 - 2 * k); }
  lightAt(x, y, z) { const m = this.meta, W = this.S.Walk, zc = z + 1.2; let e = 0.085; const a = this.lg && this.lg.get(Math.floor(x / 6) * 100003 + Math.floor(y / 6));
    if (a) for (const l of a) { const dz = l.z - zc; if (dz < -0.35 || dz > l.reach) continue; const dx = l.x - x, dy = l.y - y, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 81) continue; e += l.I * 0.72 / (1 + d2 / 5.5) * (d2 > 49 ? (81 - d2) / 32 : 1); }
    if (z > m.zM - 0.5 && this.wells) for (const f of this.wells) { const uu = W.u(f, x, y) + f.l / 2, v = Math.abs(W.v(f, x, y)); if (uu < -1 || uu > f.l + 5 || v > 3) continue; e += DAY * Math.exp(-Math.max(0, m.zWalk - zc) / 2.4) * (uu < m.lOpen ? 1 : Math.exp(-(uu - m.lOpen) / 1.7)) * (v > f.w / 2 + 0.1 ? Math.exp(-(v - f.w / 2) / 0.8) : 1) * 0.8; }
    return Math.min(e, 1.7) * this.S.K; }
  remove(a) { const i = this.agents.indexOf(a); if (i >= 0) this.agents.splice(i, 1); if (a.spot && a.spot.who === a) a.spot.who = null; if (a.home) { a.home.n--; a.home = null; } if (a.pair) { a.pair.pair = null; a.pair = null; } a.gone = true; }

  // ---------------------------------------------------------------- ways on a platform: out to the clear lane, along it (keeping right on a long walk), in to the place
  lateral(P, u, va, vb) { if (Math.abs(u) > P.hl - 0.4) return false; const n = Math.max(1, Math.ceil(Math.abs(vb - va) / 0.15)); for (let i = 0; i <= n; i++) { const [x, y] = P.map(u, va + (vb - va) * i / n); if (!this.walk.free(x, y, this.meta.zP, 0.28)) return false; } return true; }
  cross(P, u, va, vb, dir) { if (Math.abs(va - vb) < 0.05) return u; for (let k = 0; k < 36; k++) for (const sg of k ? [dir, -dir] : [1]) { const uu = u + sg * k * 0.3; if (this.lateral(P, uu, va, vb)) return uu; } return u; }
  route(P, u0, v0, u1, v1) { const out = [], push = (u, v) => { const [x, y] = P.map(u, v); out.push({ k: 'go', x, y }); }, du = u1 - u0, dir = Math.sign(du) || 1;
    if (Math.abs(du) < 1.6) { let ok = true; const n = Math.ceil(Math.hypot(du, v1 - v0) / 0.15) || 1; for (let i = 1; i <= n && ok; i++) { const [x, y] = P.map(u0 + du * i / n, v0 + (v1 - v0) * i / n); if (!this.walk.free(x, y, this.meta.zP, 0.28)) ok = false; } if (ok) { push(u1, v1); return out; } }
    const side = (v) => (Math.abs(v) < 0.2 ? 0 : Math.sign(v)); let s0 = side(v0), s1 = side(v1); if (!s0) s0 = s1 || (this.rand() < 0.5 ? -1 : 1); if (!s1) s1 = s0;
    const st = Math.abs(du) > 6 ? (dir > 0 ? -1 : 1) : s0, L0 = P.lane[s0], Lt = P.lane[st], L1 = P.lane[s1];      // v is to the left of +u: walking +u, the right-hand lane is the one at -v
    let ua = this.cross(P, u0, v0, L0, dir); if (Math.abs(ua - u0) > 0.05) push(ua, v0); push(ua, L0);
    if (Lt !== L0) { const ux = this.cross(P, ua + dir * 0.6, L0, Lt, dir); push(ux, L0); push(ux, Lt); ua = ux; }
    const ub = this.cross(P, u1, L1, v1, -dir); let uc = ub;
    if (Lt !== L1) { uc = this.cross(P, ub - dir * 0.6, Lt, L1, -dir); push(uc, Lt); push(uc, L1); }
    push(ub, L1); if (Math.abs(v1 - L1) > 0.05) push(ub, v1); if (Math.abs(ub - u1) > 0.05) push(u1, v1); return out; }
  platOf(a) { const W = this.S.Walk; for (const P of this.plats) if (Math.abs(W.u(P.f, a.x, a.y)) <= P.hl + 0.5 && Math.abs(W.v(P.f, a.x, a.y)) <= P.hw + 0.5) return P; return null; }
  uv(P, a) { const W = this.S.Walk; return [W.u(P.f, a.x, a.y), W.v(P.f, a.x, a.y)]; }

  // ---------------------------------------------------------------- flows: down from the street to wait, up from the trains to the street
  // one search at a time, a slice of it every step (about a millisecond): first the rescues, then the station's own ways
  ways() { const t0 = now(); if (!this.search) { const q = this.wayQ.shift() || this.pathQ.pop(); if (!q) return; this.search = { q, gen: findWay(this.walk, q.from, q.to, { max: q.max || 9000 }), ms: 0 }; }
    const s = this.search; let r; do { r = s.gen.next(); } while (!r.done && now() - t0 < 1.1); s.ms += now() - t0; if (!r.done) return; this.search = null; const pts = r.value, q = s.q; this.R.stats.navMs = Math.round(s.ms); this.R.stats.navMax = Math.max(this.R.stats.navMax || 0, this.R.stats.navMs);
    if (q.done) { q.done(pts); return; }
    if (pts && pts.length > 3) { const p = { pts, s: q.s, e: q.e }; this.room(pts); q.s.paths.push(p); this.paths.push(p); } else this.R.stats.noWay = (this.R.stats.noWay || 0) + 1; }
  flows(dt) { const r = this.rand;
    if (!this.paths.length) return;
    if (!this.seeded && (this.paths.length >= 4 || (!this.pathQ.length && !this.search))) { this.seeded = true; const n = Math.round(10 * this.R.scale);
      for (let i = 0; i < n; i++) { const p = this.pick(this.paths), k = 2 + Math.floor(r() * (p.pts.length - 4)), q = p.pts[k]; if (this.agents.some((o) => Math.hypot(o.x - q[0], o.y - q[1]) < 1.2 && Math.abs(o.z - q[2]) < 1)) continue; if (i % 2) this.inbound(p, k); else this.outbound(null, p, k); } }
    this.spawnT -= dt; if (this.spawnT <= 0) { this.spawnT = 0.8 + r() * 1.6; let best = null; for (const P of this.plats) if (P.stairs.some((s) => s.paths.length) && (!best || P.target - P.n > best.target - best.n)) best = P; if (best && best.n < best.target) { const ps = []; for (const s of best.stairs) ps.push(...s.paths); this.inbound(this.pick(ps), 0); } }
    this.turnT -= dt; if (this.turnT <= 0) { this.turnT = 4 + r() * 6; const p = this.S.pos, L = this.agents.filter((a) => a.mode === 'wait' && !a.plan && !a.pair && a.spot && Math.hypot(a.x - p.x, a.y - p.y) > 6); if (L.length) this.outbound(this.pick(L)); } }
  // how far to the right of a way one can keep, at each of its points and in each direction (0 where the floor is too narrow: stair heads, doorways)
  room(pts) { const n = pts.length, R = [new Float32Array(n), new Float32Array(n)], raw = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1, q = pts[i]; for (let d = 0; d < 2; d++) { const sg = d ? -1 : 1, ox = sg * ty / tl, oy = -sg * tx / tl; raw[d][i] = this.walk.free(q[0] + ox * 0.3, q[1] + oy * 0.3, q[2], 0.3) && this.walk.free(q[0] + ox * 0.15, q[1] + oy * 0.15, q[2], 0.3) ? 0.3 : 0; } }
    for (let d = 0; d < 2; d++) for (let i = 0; i < n; i++) { let m = 1; for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) if (!raw[d][k]) m = Math.min(m, Math.abs(k - i) / 4); R[d][i] = 0.3 * m; }
    pts.room = R; }
  inbound(p, k) { const P = p.s.P, free = P.spots.filter((s) => !s.who); if (!free.length) return null; const s = this.pick(free), q = p.pts[k], a = this.person(q[0], q[1], q[2], 0), o = 0.3;
    a.home = P; a.spot = s; s.who = a; P.n++; a.mode = 'walk'; this.agents.push(a); if (k > 0) { const n = p.pts[Math.min(k + 1, p.pts.length - 1)]; a.h = Math.atan2(n[1] - q[1], n[0] - q[0]); }
    a.plan = [{ k: 'path', P: p.pts, i: k, dir: 1, off: o }, { k: 'do', f: () => { const [u0, v0] = this.uv(P, a); a.plan.push(...this.route(P, u0, v0, s.u, s.v), { k: 'do', f: () => { a.mode = 'wait'; a.face = s.h; this.count.arrived++; } }); } }]; return a; }
  // someone leaves for the street: a (who waits or has just stepped off a train), or a new person part way up the way p
  outbound(a, p, k) { if (!a) { const q = p.pts[k]; a = this.person(q[0], q[1], q[2], 0); const n = p.pts[Math.max(k - 1, 0)]; a.h = Math.atan2(n[1] - q[1], n[0] - q[0]); a.mode = 'walk'; this.agents.push(a); a.plan = [{ k: 'path', P: p.pts, i: k, dir: -1, off: 0.3 }, { k: 'do', f: () => { this.count.left++; this.remove(a); } }]; return a; }
    const P = this.platOf(a); if (!P) return null; const [u0, v0] = this.uv(P, a), ss = P.stairs.filter((s) => s.paths.length).sort((x, y) => Math.abs(x.u - u0) - Math.abs(y.u - u0)); if (!ss.length) return null;
    const s = ss.length > 1 && this.rand() < 0.25 ? ss[1] : ss[0], way = this.pick(s.paths); if (a.spot && a.spot.who === a) a.spot.who = null; a.spot = null; if (a.home) { a.home.n--; a.home = null; } a.mode = 'walk'; a.face = undefined;
    a.plan = [...this.route(P, u0, v0, s.u, s.v), { k: 'path', P: way.pts, i: way.pts.length - 1, dir: -1, off: 0.3 }, { k: 'do', f: () => { this.count.left++; this.remove(a); } }]; return a; }

  // ---------------------------------------------------------------- trains: who is aboard, and the change at a stop
  doorsOf(t) { let D = this.doors.get(t); if (D) return D; const tr = t.train, P = this.plats.find((q) => q.i === t.T.plat), W = this.S.Walk; if (!P || !tr || !tr.doors) return null;
    const at0 = (lx, lz) => [t.mx + t.ux * lz - t.uy * lx, t.my + t.uy * lz + t.ux * lx], ox = t.side * (tr.width / 2 + 0.5), list = [];
    for (const d of tr.doors) { if (d.side !== t.side) continue; const [x, y] = at0(ox, d.z); list.push({ d, x, y, u: W.u(P.f, x, y), v: W.v(P.f, x, y), out: 0, inn: 0, lastOut: -9 }); }
    D = { list, P, open: false, closing: false }; this.doors.set(t, D); return D; }
  benchStand(a) {
    if (this.R.g?.P?.get('seatcam') === '0') return;
    if (!a.stand) return;
    const stand = ['Wait', 'IdleShift', 'PhoneStand'].includes(a.stand.name) ? this.R.clip('Idle') : a.stand;
    if (!stand) return;
    a.stand = stand;
    this.setClip(a, stand, 0);
    a.blendEnd = 0;
  }
  aboard(t) { let O = this.occ.get(t); if (O) return O; const tr = t.train, r = this.rand, zf = t.T.z + tr.floorY; O = { list: [], act: new Set(), seat: new Array(tr.seats.length).fill(null), stand: new Array(tr.stand.length).fill(null) }; this.occ.set(t, O);
    const k = this.R.scale, dens = []; for (let i = 0; i < (tr.cars || 8); i++) dens.push(0.45 + r() * 0.95);
    const playerSeat = this.S.ride?.t === t ? this.S.sit?.seat : null;
    tr.seats.forEach((s, i) => { if (r() > 0.42 * k * dens[s.car] || s === playerSeat) return; const a = this.person(0, 0, zf, 0); a.car = t; a.carI = s.car; a.lx = s.x; a.lz = s.z; a.lh = s.face > 0 ? 0 : Math.PI; a.mode = 'seat'; a.place = { kind: 'seat', i }; O.seat[i] = a; a.light = this.S.K * 1.05; this.sit(a, 0.43, true); O.list.push(a); });
    tr.stand.forEach((s, i) => { if (r() > 0.26 * k * dens[s.car]) return; const a = this.person(0, 0, zf, 0); a.car = t; a.carI = s.car; a.lx = s.x; a.lz = s.z; a.lh = (s.x > 0 ? Math.PI : 0) + (r() - 0.5) * 1.6; a.mode = 'stand'; a.place = { kind: 'stand', i }; O.stand[i] = a; this.benchStand(a); a.light = this.S.K * 1.05; O.list.push(a); });
    return O; }
  isOpen(t, f = 0.8) { return t.state === 'dwell' && t.doors >= f; }
  // the doors open: some step off (those nearest each door), some of those who wait for this track step on
  exchange(t) { const D = this.doorsOf(t), O = this.aboard(t), r = this.rand, tr = t.train; if (!D) return; D.open = true; D.closing = false; const ax = (tr.walk[0] ? tr.walk[0].x1 : 0.9), hw = tr.width / 2, T0 = this.R.time;
    for (const dr of D.list) { dr.out = 0; dr.inn = 0; const d = dr.d, n = (() => { const q = r(); return q < 0.72 ? 0 : q < 0.94 ? 1 : 2; })(), near = O.list.filter((a) => a.carI === d.car && !a.plan && Math.abs(a.lz - d.z) < 4.4).sort((p, q) => Math.abs(p.lz - d.z) - Math.abs(q.lz - d.z)).slice(0, 7);
      for (let i = 0; i < n && near.length; i++) { const a = near.splice(Math.floor(r() * near.length), 1)[0], dz = d.z + (r() - 0.5) * 0.5, xa = t.side * ax * (0.2 + r() * 0.5), k = dr.out++; a.leaving = dr;
        const fail = () => { dr.out = Math.max(0, dr.out - 1); a.leaving = null; a.plan = null; a.mode = 'stand'; a.place = { kind: 'free' }; O.act.delete(a); };
        a.plan = [{ k: 'wait', t: 0.5 + k * 0.85 + r() * 0.4 }, { k: 'do', f: () => { if (a.place && a.place.kind === 'seat') { O.seat[a.place.i] = null; this.unsit(a); } else if (a.place && a.place.kind === 'stand') O.stand[a.place.i] = null; a.place = null; a.mode = 'off'; } },
          { k: 'lgo', x: Math.sign(a.lx || 1) * Math.min(Math.abs(a.lx), ax - 0.15), z: a.lz }, { k: 'lgo', x: xa, z: dz }, { k: 'wait', until: () => this.isOpen(t), fail: () => !(t.state === 'dwell') || D.closing, onFail: fail },
          { k: 'lgo', x: t.side * (hw + 0.5), z: dz, sill: true, onFail: fail }, { k: 'do', f: () => this.stepOff(a, t, dr) }]; O.act.add(a); } }
    if (!this.ready) return;
    // A pair of pursuing officers needs the doorway for this boarding wave.
    const occupied = new Set(), shared = new Set();
    const heat = this.R.g.combat?.heat;
    if (heat?.level && !heat.dead && this.R.g.P?.get('copsubway') !== '0') {
      for (const cop of heat.cops) {
        const sub = cop.sub;
        if (cop.hp <= 0 || cop.mode === 'leave' || sub?.intercept !== t || sub.ride?.in || !sub.boardDoor) continue;
        if (occupied.has(sub.boardDoor)) shared.add(sub.boardDoor);
        occupied.add(sub.boardDoor);
      }
    }
    for (const a of this.agents) { if (a.mode !== 'wait' || a.plan || !a.spot || a.spot.tr !== t.T || a.boardT) continue; if (a.pair && !a.pair.gone) continue; if (r() > 0.72) continue;
      let best = null, bd = 9.5; for (const dr of D.list) { if (dr.inn >= 3 || shared.has(dr.d)) continue; const dd = Math.abs(dr.u - a.spot.u); if (dd < bd) { bd = dd; best = dr; } } if (!best) continue; best.inn++; a.boardT = t; this.todo.push(() => { if (!a.gone && a.mode === 'wait' && !a.plan && a.boardT === t) { if (this.isOpen(t, 0) && !D.closing) this.board(a, t, D, best); else { a.boardT = null; best.inn--; } } }); } }
  board(a, t, D, dr) { const P = D.P, s = a.spot, k = dr.inn - 1, sg = (s.u >= dr.u ? 1 : -1) * (k === 2 ? -1 : 1), fu = dr.u + sg * (1.0 + (k === 1 ? 0.62 : 0)), [fx, fy] = P.map(fu, dr.v); a.boardT = t; a.boardD = dr; a.mode = 'walk'; a.face = undefined;
    const back = () => this.unboard(a);
    a.plan = [{ k: 'wait', t: this.rand() * 0.8 }, ...this.route(P, s.u, s.v, fu, dr.v), { k: 'face', h: P.f.a + Math.sign(dr.v) * Math.PI / 2 - sg * 0.5 * Math.sign(dr.v) },
      { k: 'wait', until: () => dr.out === 0 && this.R.time - dr.lastOut > 0.5 && this.isOpen(t, 0.85), fail: () => t.state !== 'dwell' || D.closing, onFail: back }, { k: 'go', x: dr.x, y: dr.y, near: 0.16, fail: () => !this.isOpen(t, 0.5), onFail: back }, { k: 'do', f: () => { if (this.isOpen(t, 0.5)) this.stepOn(a, t, dr); else back(); } }]; }
  // a place to wait for someone who stands on a platform without one
  settle(a, P) { const [u0, v0] = this.uv(P, a), free = P.spots.filter((s) => !s.who).sort((x, y) => Math.abs(x.u - u0) - Math.abs(y.u - u0)); if (!free.length) { if (!this.outbound(a)) a.mode = 'wait'; return; } const s = free[Math.floor(this.rand() * Math.min(4, free.length))];
    a.spot = s; s.who = a; a.home = P; P.n++; a.mode = 'walk'; a.plan = [...this.route(P, u0, v0, s.u, s.v), { k: 'do', f: () => { a.mode = 'wait'; a.face = s.h; } }]; }
  unboard(a) { const s = a.spot, P = a.home; if (a.boardD) a.boardD.inn = Math.max(0, a.boardD.inn - 1); a.boardT = a.boardD = null; if (!s || !P) { a.plan = null; a.mode = 'wait'; return; } const [u0, v0] = this.uv(P, a); a.plan = [...this.route(P, u0, v0, s.u, s.v), { k: 'do', f: () => { a.mode = 'wait'; a.face = s.h; } }]; }
  stepOn(a, t, dr) { const O = this.aboard(t), tr = t.train, d = dr.d, r = this.rand, [lx, lz] = this.S.tLocal(t, a.x, a.y), ax = tr.walk[0] ? tr.walk[0].x1 : 0.9, hw = tr.width / 2;
    const i = this.agents.indexOf(a); if (i >= 0) this.agents.splice(i, 1); if (a.spot && a.spot.who === a) a.spot.who = null; a.spot = null; if (a.home) { a.home.n--; a.home = null; } a.boardT = null;
    a.car = t; a.carI = d.car; a.lx = lx; a.lz = lz; a.lh = t.side > 0 ? Math.PI : 0; a.z = t.T.z + tr.floorY; a.mode = 'on'; a.light = this.S.K * 1.05; O.list.push(a); O.act.add(a);
    // a seat near the door if one is free, else a place to stand, else the aisle beside the door
    let place = null; const want = r() < 0.7 ? ['seat', 'stand'] : ['stand', 'seat'];
    const playerSeat = this.S.ride?.t === t ? this.S.sit?.seat : null;
    for (const kind of want) { const L = kind === 'seat' ? tr.seats : tr.stand, who = O[kind]; let bi = -1, bd = 5.2; for (let j = 0; j < L.length; j++) { if (who[j] || L[j].car !== d.car || L[j] === playerSeat) continue; const dd = Math.abs(L[j].z - d.z) + r() * 1.5; if (dd < bd) { bd = dd; bi = j; } } if (bi >= 0) { place = { kind, i: bi, x: L[bi].x, z: L[bi].z, face: L[bi].face }; who[bi] = a; break; } }
    if (!place) place = { kind: 'free', x: (r() < 0.5 ? -1 : 1) * (0.2 + r() * (this.R.g?.P?.get('seatcam') === '0' ? 0.4 : Math.min(0.4, Math.max(0, ax - 0.52)))), z: d.z + (r() < 0.5 ? -1 : 1) * (1.0 + r() * 0.9) };
    const platformX = a.x, platformY = a.y;
    a.place = place; const dz = clamp(lz, d.z - 0.3, d.z + 0.3), xa = -t.side * ax * (r() * 0.5), fail = () => { // the doors shut in his face: back onto the platform
      if (place.kind !== 'free') O[place.kind][place.i] = null; a.place = null; this.offTrain(a, t, O);
      if (!this.walk.free(a.x, a.y, a.z, RB)) {
        a.x = platformX; a.y = platformY;
        if (!this.walk.free(a.x, a.y, a.z, RB) && this.walk.free(dr.x, dr.y, a.z, RB)) {
          a.x = dr.x; a.y = dr.y;
        }
      }
      a.mode = 'wait'; a.plan = null; this.agents.push(a); dr.inn = Math.max(0, dr.inn - 1); this.settle(a, this.doorsOf(t).P); };
    a.plan = [{ k: 'lgo', x: t.side * (hw - 0.35), z: dz, sill: true, onFail: fail }, { k: 'do', f: () => { this.count.boarded++; dr.inn = Math.max(0, dr.inn - 1); } }, { k: 'lgo', x: xa, z: dz }, { k: 'lgo', x: clamp(place.x, -ax + 0.12, ax - 0.12), z: place.z, tolerance: place.kind === 'stand' && this.R.g?.P?.get('seatcam') !== '0' ? 0.01 : 0.07 },
      { k: 'do', f: () => { if (place.kind === 'seat') { a.lx = place.x; a.lh = place.face > 0 ? 0 : Math.PI; a.mode = 'seat'; this.sit(a, 0.43); } else { a.lx = place.x; a.mode = 'stand'; a.lh = (place.x > 0 ? Math.PI : 0) + (r() - 0.5) * 1.4; if (place.kind === 'stand') this.benchStand(a); } O.act.delete(a); a.plan = null; } }]; }
  offTrain(a, t, O) { const i = O.list.indexOf(a); if (i >= 0) O.list.splice(i, 1); O.act.delete(a); const [x, y] = this.S.tMap(t, a.lx, a.lz); a.x = x; a.y = y; a.z = this.meta.zP; a.car = null;
    const dx = Math.cos(a.lh), dz = Math.sin(a.lh); a.h = Math.atan2(t.uy * dz + t.ux * dx, t.ux * dz - t.uy * dx); a.light = this.lightAt(x, y, a.z); }
  stepOff(a, t, dr) { const O = this.occ.get(t); if (!O) return; this.offTrain(a, t, O); dr.out = Math.max(0, dr.out - 1); dr.lastOut = this.R.time; a.leaving = null; this.count.alighted++; a.mode = 'walk'; a.plan = null;
    if (!this.walk.free(a.x, a.y, a.z, RB)) { a.x = dr.x; a.y = dr.y; } this.agents.push(a);
    if (!this.outbound(a)) { const P = this.doorsOf(t).P, [u0, v0] = this.uv(P, a), tu = u0 + (this.rand() < 0.5 ? -1 : 1) * (1.5 + this.rand() * 2); a.plan = [...this.route(P, u0, v0, clamp(tu, -P.hl + 2, P.hl - 2), P.lane[Math.sign(v0) || 1] * 0.5), { k: 'wait', until: () => this.paths.length > 0 }, { k: 'do', f: () => { if (!this.outbound(a)) a.mode = 'wait'; } }]; } }
  onTrain(kind, t) { if (kind === 'arrive') this.aboard(t); else if (kind === 'doors-open') this.exchange(t); else if (kind === 'doors-close') { const D = this.doors.get(t); if (D) { D.closing = true; D.open = false; } }
    else if (kind === 'leave') {
      const roster = this.occ.get(t);
      if (!roster) return;
      for (const a of roster.act) {
        const sill = a.plan?.[0];
        if (a.mode !== 'on' || !sill?.sill) continue;
        if (Math.abs(a.lx) > t.train.width / 2 + 0.2) {
          sill.onFail();
          continue;
        }
        // Finish the doorway crossing before this train's boarding counter transfers.
        a.lx = sill.x; a.lz = sill.z;
        a.plan.shift();
        a.plan.shift().f();
      }
    }
    else if (kind === 'gone') { if (!(this.S.ride && this.S.ride.t === t)) this.occ.delete(t); } }

  // ---------------------------------------------------------------- stepping
  step(dt) { this.age += dt; if (this.gen) { const t0 = now(); for (;;) { const q = this.gen.next(); if (q.done) { this.gen = null; break; } if (q.value === 'wait' || now() - t0 > 2.2) break; } }
    const S = this.S; for (const t of this.u.trains) if (t.train && t.train.group.visible && !this.occ.has(t)) this.aboard(t);
    if (this.ready) { this.ways(); this.flows(dt); if (this.todo.length) this.todo.shift()(); }
    const p = S.pos, px = p.x, py = p.y, pz = p.z, A = this.agents; this.rescueT -= dt;
    this.tick = (this.tick || 0) + 1; for (let i = A.length - 1; i >= 0; i--) { const a = A[i]; if (!a.plan) { this.idle(a, dt, px, py, pz); continue; }
      // out of the player's sight (far along the platform, or on the other level) a walker is stepped every third step
      const dx = a.x - px, dy = a.y - py; if (dx * dx + dy * dy > 900 || (Math.abs(a.z - pz) > 2.5 && dx * dx + dy * dy > 144)) { a.acc = (a.acc || 0) + dt; if ((this.tick + i) % 3) continue; const d3 = Math.min(a.acc, 0.12); a.acc = 0; this.run(a, d3, px, py, pz); } else this.run(a, dt, px, py, pz); }
    // Use the walk mesh so making room for an officer respects columns and the platform edge.
    const heat = this.R.g.combat?.heat;
    if (heat?.level && this.R.g.P?.get('copsubway') !== '0') for (const cop of heat.cops) {
      if (cop.hp <= 0 || cop.sub?.u !== this.u || cop.sub.phase !== 'under') continue;
      const ride = cop.sub.ride;
      // Platform riders are outside the car. Resume checks as an officer approaches either sill.
      if (ride?.in && Math.abs(ride.lx) + RB + 0.31 < ride.t.train.width / 2) continue;
      for (const a of A) {
        if (a.mode === 'sit' || Math.abs(a.z-cop.z) >= 0.6) continue;
        const dx = a.x-cop.x, dy = a.y-cop.y, radius = RB + 0.31;
        if (Math.abs(dx) >= radius || Math.abs(dy) >= radius) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= radius) continue;
        const shift = radius-distance;
        this.walk.move(a, distance ? dx/distance*shift : shift, distance ? dy/distance*shift : 0, RB);
      }
    }
    for (const [t, O] of this.occ) { if (O.act.size) for (const a of [...O.act]) this.runCar(a, t, O, dt);
      if (S.ride && S.ride.t === t) { const rx = S.ride.lx, rz = S.ride.lz, tr = t.train; for (const a of O.list) { if (a.plan || a.mode === 'seat') continue; const dx = a.lx - rx, dz = a.lz - rz, d = Math.hypot(dx, dz); if (d < 0.72) { const w = tr.walk[a.carI] || tr.walk[0], k = Math.min(1.2 * dt, 0.72 - d) / (d || 1); a.lx = clamp(a.lx + (d ? dx : 0.1) * k, w.x0 + 0.1, w.x1 - 0.1); a.lz = clamp(a.lz + (d ? dz : 0.1) * k, w.z0 + 0.2, w.z1 - 0.2); } } } } }
  idle(a, dt, px, py, pz) { // waiting: gives the player room, turns to where he looks
    if (a.mode === 'sit') return; const dx = a.x - px, dy = a.y - py, q = dx * dx + dy * dy;
    if (q < 0.5 && Math.abs(a.z - pz) < 1.2) { const d = Math.sqrt(q) || 0.01, s = 1.0 * dt; this.walk.move(a, dx / d * s, dy / d * s, RB); a.moved = 0.4; if (a.pair) { a.pair.pair = null; a.pair.stand = this.R.anyStand; this.setClip(a.pair, a.pair.stand); a.pair = null; a.stand = this.R.anyStand; } this.setClip(a, a.walk, 0.2); a.ph += dt * 0.7 / a.walk.dur; }
    else if (a.moved > 0) { a.moved -= dt; if (a.moved <= 0) this.setClip(a, a.stand, 0.3); }
    if (a.face !== undefined) { const d = wrapA(a.face - a.h); if (Math.abs(d) < 0.02) a.face = undefined; else a.h += clamp(d, -4 * dt, 4 * dt); if (a.clip !== a.stand && !(a.moved > 0)) this.setClip(a, a.stand, 0.3); } }
  run(a, dt, px, py, pz) { if (a.waitWay) { this.still(a, dt); return; } for (let n = 0; n < 4; n++) { const st = a.plan && a.plan[0]; if (!st) { a.plan = null; if (a.mode === 'walk') a.mode = 'wait'; this.still(a, dt); return; }
      if (st.fail && st.fail()) { const f = st.onFail; a.plan.shift(); if (f) f(); else continue; return; }
      if (st.k === 'do') { a.plan.shift(); st.f(); if (a.gone || a.car) return; continue; }
      if (st.k === 'face') { a.face = st.h; a.plan.shift(); continue; }
      if (st.k === 'wait') { if (st.until ? st.until() : (st.t -= dt) <= 0) { a.plan.shift(); continue; } this.still(a, dt); if (a.face !== undefined) a.h += clamp(wrapA(a.face - a.h), -4 * dt, 4 * dt); const dx = a.x - px, dy = a.y - py, q = dx * dx + dy * dy; if (q < 0.4 && Math.abs(a.z - pz) < 1.2) { const d = Math.sqrt(q) || 0.01; this.walk.move(a, dx / d * dt, dy / d * dt, RB); } return; }
      if (st.k === 'go') { if (st.sx === undefined) { st.sx = a.x; st.sy = a.y; } if (Math.hypot(st.x - a.x, st.y - a.y) < (st.near || 0.22)) { a.plan.shift(); continue; }
        // he keeps to the line of this leg (it was tested clear): stepping round someone must not leave him behind the next column
        let tx = st.x, ty = st.y; const lx = st.x - st.sx, ly = st.y - st.sy, L = Math.hypot(lx, ly); if (L > 2) { const t = clamp(((a.x - st.sx) * lx + (a.y - st.sy) * ly) / L + 1.2, 0, L); if (t < L - 0.01) { tx = st.sx + lx * t / L; ty = st.sy + ly * t / L; } }
        this.moveTo(a, tx, ty, dt, px, py, pz, 0.03); if (a.stuck > 1.3) this.unstick(a, st); return; }
      if (st.k === 'path') { const P = st.P; let q = P[st.i]; while (q && Math.hypot(q[0] - a.x, q[1] - a.y) < 0.85 && Math.abs(q[2] - a.z) < 1.2) { st.i += st.dir; q = P[st.i]; } if (!q) { a.plan.shift(); continue; }
        const j = clamp(st.i + st.dir, 0, P.length - 1), n1 = P[j], tx = n1[0] - q[0], ty = n1[1] - q[1], tl = Math.hypot(tx, ty) || 1, of = st.off ? (P.room ? P.room[st.dir > 0 ? 0 : 1][st.i] : st.off) : 0, ox = (ty / tl) * of, oy = (-tx / tl) * of;      // keep right, where there is room
        this.moveTo(a, q[0] + ox, q[1] + oy, dt, px, py, pz, 0.05);
        if (a.stuck > 1.3) { if (st.off) { st.off = 0; a.stuck = 0.6; } else { a.stuck = 0; let bi = st.i, bd = 1e9; for (let k = Math.max(0, st.i - 6); k < Math.min(P.length, st.i + 7); k++) { const d = Math.hypot(P[k][0] - a.x, P[k][1] - a.y) + Math.abs(P[k][2] - a.z) * 3; if (d < bd) { bd = d; bi = k; } } if (bd < 0.5) st.i = clamp(bi + st.dir, 0, P.length - 1); else if (this.walk.free(P[bi][0], P[bi][1], P[bi][2], RB) && !this.R.seen(a.x, a.y, a.z)) { a.x = P[bi][0]; a.y = P[bi][1]; a.z = P[bi][2]; } else this.unstick(a, { x: P[bi][0], y: P[bi][1], z: P[bi][2], path: st }); } }
        return; }
      a.plan.shift(); } }
  still(a, dt) { a.v = 0; a.vx = a.vy = 0; a.stillT += dt; if (a.stillT > 0.25 && a.clip !== a.stand) this.setClip(a, a.stand, 0.3); }
  // stuck on a 'go': a found way to the same point (seldom: one search at most every half second), or, out of sight, simply there
  unstick(a, st) { a.stuck = 0; if (a.waitWay || this.wayQ.length > 3) return; if (this.R.debug && !st.path) { const P = this.platOf(a); if (P) { const W = this.S.Walk, f = P.f; this.R.debug('stuck ' + a.mode + ' at u ' + W.u(f, a.x, a.y).toFixed(2) + ' v ' + W.v(f, a.x, a.y).toFixed(2) + ' going to u ' + W.u(f, st.x, st.y).toFixed(2) + ' v ' + W.v(f, st.x, st.y).toFixed(2) + ' lanes ' + P.lane[-1] + ' ' + P.lane[1] + ' edge ' + P.edge[-1] + ' ' + P.edge[1] + ' board ' + !!a.boardT + ' plan ' + a.plan.map((q) => q.k).join(',')); } } this.rescues++; const fin = st.path ? st : a.plan.filter((q) => q.k === 'go').pop() || st, to = { x: fin.x, y: fin.y, z: st.path ? st.z : this.meta.zP }, plan = a.plan; a.waitWay = true;
    this.wayQ.push({ from: { x: a.x, y: a.y, z: a.z }, to, max: 2500, done: (pts) => { a.waitWay = false; if (a.gone || a.car || a.plan !== plan) return;
      if (this.R.debug) this.R.debug('rescue ' + a.mode + ' at ' + a.x.toFixed(1) + ',' + a.y.toFixed(1) + ',' + a.z.toFixed(1) + ' to ' + to.x.toFixed(1) + ',' + to.y.toFixed(1) + ',' + to.z.toFixed(1) + ' ' + (pts ? pts.length : 'none') + (st.path ? ' (on a way)' : ' (on a platform)'));
      if (pts && pts.length > 1) { if (!st.path) while (a.plan.length && a.plan[0].k === 'go') a.plan.shift(); a.plan.unshift({ k: 'path', P: pts, i: 0, dir: 1, off: 0 }); }
      else if (!this.R.seen(a.x, a.y, a.z) || (a.rescueN = (a.rescueN || 0) + 1) > 3) { this.lost++; if (a.boardD) a.boardD.inn = Math.max(0, a.boardD.inn - 1); this.remove(a); } } }); }
  // one step towards (tx, ty) through the station's own collision; slows behind people going the same way, steps round those who stand, stops for the player
  moveTo(a, tx, ty, dt, px, py, pz, near) { let dx = tx - a.x, dy = ty - a.y; const d = Math.hypot(dx, dy); if (d < near) return true; dx /= d; dy /= d;
    let side = 0, slow = 1, hold = false; a.ghostT -= dt;
    { const rx = px - a.x, ry = py - a.y; if (Math.abs(pz - a.z) < 1.3) { const q = rx * rx + ry * ry; if (q < 3.2) { const f = rx * dx + ry * dy, l = -rx * dy + ry * dx; if (f > -0.15 && Math.abs(l) < 0.8) { const dd = Math.sqrt(q); if (dd < 0.7 && f > 0.25) hold = true; side += (l > 0 ? -1 : 1) * (1 - Math.abs(l) / 0.8) * 1.5; slow = Math.min(slow, clamp((dd - 0.55) / 0.9, 0.15, 1)); } } } }
    if (a.ghostT <= 0) { let blocked = false; for (const b of this.agents) { if (b === a) continue; const rx = b.x - a.x, ry = b.y - a.y, q = rx * rx + ry * ry; if (q > 1.1 || Math.abs(b.z - a.z) > 1) continue; const f = rx * dx + ry * dy, l = -rx * dy + ry * dx; if (f <= 0 || Math.abs(l) > 0.56) continue; const dd = Math.sqrt(q);
        if (b.v > 0.3 && b.vx * dx + b.vy * dy > 0.3 * b.v) slow = Math.min(slow, clamp((dd - 0.5) / 0.45, 0, 1)); else { side += (l > 0 ? -1 : 1) * (1 - Math.abs(l) / 0.56) * (b.v > 0.3 ? 0.9 : 1.2); if (dd < 0.45) { slow = Math.min(slow, 0.25); blocked = true; } } }
      if (blocked || slow < 0.2) { a.blockT += dt; if (a.blockT > 1.4) { a.ghostT = 1.2; a.blockT = 0; } } else a.blockT = Math.max(0, a.blockT - dt * 0.5); }
    side = clamp(side, -1.5, 1.5); let ex = dx - dy * side * 0.8, ey = dy + dx * side * 0.8; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const sp = a.v0 * (a.stair ? 0.68 : 1) * slow * Math.min(1, 0.35 + d / 0.5), step = hold ? 0 : Math.min(sp * dt, d), x0 = a.x, y0 = a.y; let f = null;
    if (step > 0) { f = this.walk.move(a, ex * step, ey * step, RB); if (f) a.stair = !!f.stair; }
    const mv = Math.hypot(a.x - x0, a.y - y0), v = dt > 0 ? mv / dt : 0; a.v += (v - a.v) * Math.min(1, dt * 10); a.vx = (a.x - x0) / (dt || 1); a.vy = (a.y - y0) / (dt || 1);
    if (mv > 1e-5) a.h += clamp(wrapA(Math.atan2(a.vy * 0.5 + ey, a.vx * 0.5 + ex) - a.h), -7 * dt, 7 * dt);
    if (!hold && slow > 0.5 && mv < step * 0.3) a.stuck += dt; else a.stuck = Math.max(0, a.stuck - dt * 2); if (a.stuck > 0.55 && a.ghostT <= 0) a.ghostT = 1.6;      /* squeezed between someone and a wall: go on through the someone, not the wall */
    if (a.v > 0.2) { a.stillT = 0; this.setClip(a, a.walk, 0.25); a.ph += dt * a.v / (a.walk.speed * a.tall) / a.walk.dur; a.ph -= Math.floor(a.ph); } else this.still(a, dt);
    a.lightT -= dt; if (a.lightT <= 0) { a.lightT = 0.35; a.light = this.lightAt(a.x, a.y, a.z); }
    return false; }
  // aboard, in the train's own frame (lx across, lz along): the aisle, the doorway, the seat
  runCar(a, t, O, dt) { const S = this.S, tr = t.train, hw = tr.width / 2;
    for (let n = 0; n < 4; n++) { const st = a.plan && a.plan[0]; if (!st) { a.plan = null; O.act.delete(a); return; }
      if (st.fail && st.fail()) { const f = st.onFail; a.plan.shift(); if (f) f(); if (!a.car) return; continue; }
      if (st.k === 'do') { a.plan.shift(); st.f(); if (!a.car || !a.plan) return; continue; }
      if (st.k === 'wait') { if (st.until ? st.until() : (st.t -= dt) <= 0) { a.plan.shift(); continue; } if (a.mode !== 'seat' && a.clip !== a.stand && a.clip.speed > 0) this.setClip(a, a.stand, 0.3); return; }
      if (st.k === 'lgo') { let dx = st.x - a.lx, dz = st.z - a.lz; const d = Math.hypot(dx, dz); if (d < (st.tolerance ?? 0.07)) { a.plan.shift(); continue; } dx /= d; dz /= d;
        // nobody goes through a door that is not open
        if (st.sill && !this.isOpen(t, 0.5) && (Math.abs(st.x) < hw ? Math.abs(a.lx) > hw + 0.2 : Math.abs(a.lx) < hw - 0.3)) { const f = st.onFail; a.plan.shift(); if (f) f(); return; }
        let slow = 1, hold = false; const D = this.doors.get(t), hurry = D && D.closing && Math.abs(a.lx) > hw - 0.5 ? 1.8 : 1;
        // the player: aboard (S.ride) or on the platform by the door
        { let rx, rz, has = false; if (S.ride && S.ride.t === t) { rx = S.ride.lx; rz = S.ride.lz; has = true; } else if (S.own && Math.abs(S.pos.z - this.meta.zP) < 1) { const q = S.tLocal(t, S.pos.x, S.pos.y); if (Math.abs(q[0]) < hw + 2) { rx = q[0]; rz = q[1]; has = true; } }
          if (has) { const ox = rx - a.lx, oz = rz - a.lz, f = ox * dx + oz * dz, l = Math.abs(-ox * dz + oz * dx), dd = Math.hypot(ox, oz); // A seated player stays at the bench. Allow a rider to finish a clear leg beside it.
            const reach = Math.min(d, Math.max(0, f));
            const clearSeat = S.sit && S.ride?.t === t && this.R.g?.P?.get('seatcam') !== '0' &&
              Math.hypot(ox - dx * reach, oz - dz * reach) >= 2 * RB;
            if (!clearSeat && f > 0 && l < 0.6 && dd < 0.95) hold = true; else if (f > 0 && l < 0.65 && dd < 1.7) slow = 0.6; } }
        a.ghostT -= dt; if (!hold && a.ghostT <= 0) { let blocked = false; for (const b of O.act) { if (b === a || b.mode === 'seat') continue; const ox = b.lx - a.lx, oz = b.lz - a.lz, q = ox * ox + oz * oz; if (q > 0.5) continue; const f = ox * dx + oz * dz; if (f > 0.05 && Math.abs(-ox * dz + oz * dx) < 0.4) { blocked = true; break; } }
          if (blocked) { a.blockT += dt; slow = 0; if (a.blockT > 1.0) { a.ghostT = 0.9; a.blockT = 0; } } else a.blockT = 0; }
        const sp = hold ? 0 : 1.15 * hurry * slow * Math.min(1, 0.4 + d / 0.4), step = Math.min(sp * dt, d); a.lx += dx * step; a.lz += dz * step; a.v = sp;
        if (step > 0) { a.lh += clamp(wrapA(Math.atan2(dz, dx) - a.lh), -8 * dt, 8 * dt); this.setClip(a, a.walk, 0.3); a.ph += dt * sp / (a.walk.speed * a.tall) / a.walk.dur; a.ph -= Math.floor(a.ph); } else if (a.clip.speed > 0) this.setClip(a, a.stand, 0.3);
        return; }
      a.plan.shift(); } }
  counts() { const zM = this.meta.zM, c = { platform: 0, mezz: 0, stairs: 0, waiting: 0, walking: 0, seated: 0, trains: 0, boarding: 0, alighting: 0 };
    for (const a of this.agents) { if (a.stair) c.stairs++; else if (a.z < zM - 2) c.platform++; else c.mezz++; if (a.mode === 'sit') c.seated++; else if (a.plan) c.walking++; else c.waiting++; if (a.boardT) c.boarding++; }
    for (const [t, O] of this.occ) { if (t.train.group.visible) c.trains += O.list.length; for (const a of O.act) { if (a.leaving) c.alighting++; else if (a.mode === 'on') c.boarding++; } } return c; }
}

// ================================================================== the part
class Riders {
  constructor(game, S) { this.g = game; this.S = S; this.pops = new Map(); this.time = 0; this.cast = null; this.draw = null; this.failed = null; this.on = true; this.stats = { ms: 0, navMs: 0 };
    const P = game.P; this.scale = clamp(+(P && P.get('riders')) || 1, 0.1, 3); this.gain = +(P && P.get('ridersgain')) || 1.25;
    if (S.ridersCast) this.setCast(S.ridersCast);
    S.on('enter', (u) => this.ensure(u)); S.on('drop', (u) => this.drop(u)); S.on('leave', () => this.show()); S.on('deep', () => this.show());
    S.on('hop', (from, to, nt, previous) => { try { this.hop(from, to, nt, previous); } catch (e) { this.fail('hop', e); } });
    S.on('train', (kind, t, u) => { const p = this.pops.get(u); if (p && this.cast) p.onTrain(kind, t); });
    S.on('step', (dt, u) => this.step(dt, u)); }
  fail(w, e) { this.fails = (this.fails || 0) + 1; if (this.fails < 6) console.warn('[subway] riders ' + w + ': ' + String((e && e.stack) || e).slice(0, 600)); }
  clip(n) { return this.cast.clips[n] || null; }
  setCast(cast) { this.cast = cast; const C = cast.clips; this.anyWalk = C.Walk || Object.values(C).find((c) => c.speed > 0.8); this.anyStand = C.Idle || Object.values(C).find((c) => !c.speed && !c.seat);
    // a dozen of the cast (half women, half men, the heights spread): a dozen draws at most per band, colours make the rest of the variety
    const used = [], n = 12; for (const fem of [true, false]) { const L = cast.chars.map((c, i) => i).filter((i) => !!cast.chars[i].female === fem && cast.chars[i].height > 1.5).sort((a, b) => cast.chars[a].height - cast.chars[b].height), m = Math.min(L.length, n >> 1); for (let i = 0; i < m; i++) used.push(L[Math.floor(((i + 0.5) / m) * L.length)]); }
    if (!used.length) used.push(...cast.chars.map((c, i) => i).slice(0, n)); this.used = used; }
  async getCast() { const g = this.g, T = this.S.THREE;
    for (let i = 0; i < 12; i++) { const c = g.crowd; if (c && c.on && c.render && c.render.baked) break; if (!c || (c.report && c.report.failed) || (c.report && c.report.ms === undefined && i > 6)) break; await new Promise((r) => setTimeout(r, 250)); }
    let cast = null; try { const c = g.crowd; if (c && c.on && c.render && c.render.baked && c.render.cast && c.render.chars) cast = castFromCrowd(g); } catch (e) { this.fail('crowd cast', e); }
    if (!cast) cast = await castOwn(T);
    this.setCast(cast); this.draw = new Draw(T, cast, this.used, this.S.LAYER, this.gain); this.g.world.scene.add(this.draw.group); this.hookAO(); this.show();
    console.log('[subway] riders: ' + cast.kind + ', ' + this.used.length + ' figures in use, ' + Object.keys(cast.clips).length + ' clips'); }
  // the ambient-occlusion pass draws the scene with one override material that knows nothing of our skinning: we stay out of it (as the crowd does)
  hookAO() { const gt = this.g.world && this.g.world.gtao; if (!gt || gt._riders || !gt.renderOverride) return; gt._riders = true; const ro = gt.renderOverride.bind(gt), self = this;
    gt.renderOverride = function (...a) { const d = self.draw, v = d && d.group.visible; if (v) d.group.visible = false; try { return ro(...a); } finally { if (v) d.group.visible = true; } }; }
  ensure(u) { if (!u || !u.walk || !u.st || !u.st.built) return null; let p = this.pops.get(u);
    if (!this.cast) { if (!this.castP && !this.failed) this.castP = this.getCast().catch((e) => { this.failed = String((e && e.message) || e); this.fail('cast', e); }); return null; }
    if (!p) { p = new Pop(this, u); this.pops.set(u, p); } return p; }
  drop(u) { this.pops.delete(u); if (!this.pops.size && this.draw && !this.S.own) { this.draw.dispose(); this.draw = null; } }
  show(v) { if (v !== undefined) this.on = !!v; if (this.draw) this.draw.group.visible = this.on && this.S.own && !!this.pops.get(this.S.unit); }
  hop(from, to, nt, previous) { const pf = this.pops.get(from), pt = this.ensure(to); if (!pf || !pt) return; const ot = previous || (this.rode && pf.occ.has(this.rode) ? this.rode : null) || from.trains.find((q) => q !== nt && (q.T.key !== undefined ? q.T.key === nt.T.key : q.T.id === nt.T.id)), O = ot && pf.occ.get(ot); if (!O) return; pf.occ.delete(ot);
    for (const a of [...O.act]) { if (a.leaving || a.mode === 'off') { a.plan = null; a.leaving = null; a.mode = 'stand'; a.place = a.place || { kind: 'free' }; O.act.delete(a); } }
    const source = ot.train, dest = nt.train;
    const changed = source.walk.length !== dest.walk.length || source.carLen !== dest.carLen || source.width !== dest.width;
    if (changed) {
      // Interior boarding routes and their completion callbacks belong to the old car.
      for (const a of O.act) {
        if (a.mode !== 'on' || a.plan?.[0]?.k !== 'lgo' || a.plan[0].sill) continue;
        const place = a.place;
        if (place && place.kind !== 'free' && O[place.kind][place.i] === a) O[place.kind][place.i] = null;
        a.place = { kind: 'free' }; a.plan = null; a.mode = 'stand'; a.v = 0;
        O.act.delete(a); pt.setClip(a, a.stand, 0.3);
      }
      const localZ = (q, tr) => q.z - (q.car - (tr.walk.length - 1) / 2) * tr.carLen;
      const playerSeat = this.S.ride?.t === nt ? this.S.sit?.seat : null;
      const seated = O.list.filter(a => a.mode === 'seat' && a.place?.kind === 'seat');
      for (const a of seated) if (O.seat[a.place.i] === a) O.seat[a.place.i] = null;
      const standing = O.list.filter(a => a.mode === 'stand' && a.place?.kind === 'stand' && !O.act.has(a));
      for (const a of standing) if (O.stand[a.place.i] === a) O.stand[a.place.i] = null;
      for (const a of standing) {
        const old = source.stand[a.place.i];
        const i = dest.stand.findIndex((q, j) => !O.stand[j] && q.car === old.car &&
          Math.abs(q.x - old.x) < 0.01 && Math.abs(localZ(q, dest) - localZ(old, source)) < 0.01);
        if (i < 0) {
          a.place = { kind: 'free' };
          continue;
        }
        const q = dest.stand[i];
        O.stand[i] = a; a.place = { kind: 'stand', i };
        a.lx = q.x; a.lz = q.z; a.carI = q.car;
      }
      // A passenger displaced on an earlier hop is still standing in car-local space.
      for (const a of O.list) {
        if (a.mode !== 'stand' || a.place?.kind !== 'free' || O.act.has(a)) continue;
        const car = Math.min(a.carI, dest.walk.length - 1), w = dest.walk[car];
        const z = a.lz - (a.carI - (source.walk.length - 1) / 2) * source.carLen;
        a.lz = clamp(z + (car - (dest.walk.length - 1) / 2) * dest.carLen, w.z0 + 0.3, w.z1 - 0.3);
        a.lx = clamp(a.lx, w.x0 + 0.24, w.x1 - 0.24);
        a.carI = car;
      }
      const fallback = [];
      const assign = (a, i) => {
        const q = dest.seats[i];
        O.seat[i] = a; a.place = { kind: 'seat', i }; a.carI = q.car;
        a.lx = q.x; a.lz = q.z; a.lh = q.face > 0 ? 0 : Math.PI;
      };
      // Keep all surviving benches before offering spare seats to displaced riders.
      for (const a of seated) {
        const old = source.seats[a.place.i];
        const i = dest.seats.findIndex((q, j) => !O.seat[j] && q !== playerSeat && q.car === old.car &&
          q.face === old.face && Math.abs(q.x - old.x) < 0.01 && Math.abs(localZ(q, dest) - localZ(old, source)) < 0.01);
        if (i >= 0) assign(a, i); else fallback.push(a);
      }
      for (const a of fallback) {
        const car = Math.min(source.seats[a.place.i].car, dest.walk.length - 1);
        const i = dest.seats.findIndex((q, j) => q.car === car && !O.seat[j] && q !== playerSeat);
        if (i >= 0) { assign(a, i); continue; }
        const w = dest.walk[car], old = source.seats[a.place.i];
        const center = (car - (dest.walk.length - 1) / 2) * dest.carLen;
        a.lx = clamp(old.x * 0.45, w.x0 + 0.24, w.x1 - 0.24);
        a.lz = clamp(center + localZ(old, source), w.z0 + 0.3, w.z1 - 0.3);
        a.carI = car; a.place = { kind: 'free' }; a.mode = 'stand';
        pt.unsit(a); pt.setClip(a, a.stand, 0.3);
      }
    }
    for (const a of O.list) a.car = nt;
    pt.occ.set(nt, O); }
  step(dt, u) { if (!u) return; const t0 = now(); try { this.time += dt; if (this.S.ride) this.rode = this.S.ride.t; const p = this.ensure(u); if (p) { p.step(dt); if (this.draw) { if (!this.draw.group.parent) this.g.world.scene.add(this.draw.group); this.show(); if (this.draw.group.visible) this.fill(p); } } } catch (e) { this.fail('step', e); }
    this.stats.ms += ((now() - t0) - this.stats.ms) * 0.05; }
  // is this spot in front of the camera and near (so that nobody appears or vanishes there)?
  seen(x, y, z) { const cam = this.g.world && this.g.world.camera; if (!cam) return false; const dx = x - cam.position.x, dy = y + cam.position.z, d = Math.hypot(dx, dy); if (d > 45) return false; if (d < 4) return true; const e = cam.matrixWorld.elements; return dx * -e[8] + dy * e[10] > d * 0.2; }
  fill(pop) { const D = this.draw, S = this.S, cam = this.g.world.camera, e = cam.matrixWorld.elements, cx = cam.position.x, cy = -cam.position.z, cz = cam.position.y, iW = 1 / this.cast.W, T = this.time, zM = S.meta.zM;
    let fx = -e[8], fy = e[10]; const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl; const hf = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect), cosV = Math.cos(Math.min(3.1, hf + 0.2)), steep = Math.abs(e[9]) > 0.6, low = cz < zM - 0.3;
    D.begin();
    const one = (a, x, y, z, h) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); if (d > DRAW_R) return; if (!(steep || d < 5 || dx * fx + dy * fy > d * cosV)) return;
      const c = a.clip, pa = c.speed > 0 ? a.ph : a.ph + T / c.dur, uA = (c.x0 + 0.5 + (pa - Math.floor(pa)) * c.F) * iW; let uB = uA, bl = 0;
      if (a.blendEnd > T && a.clipB) { bl = clamp((a.blendEnd - T) / (a.blendLen || 0.3), 0, 1); bl = bl * bl * (3 - 2 * bl); uB = (a.clipB.x0 + 0.5 + a.phB * a.clipB.F) * iW; }
      D.put(a.k, d < NEAR_R ? 0 : d < MID_R ? 1 : 2, x, y, z + (a.zo || a.zo0 ? pop.zoff(a) : 0), h, uA, uB, bl, a.scale, a.light, a.tint); };
    for (const a of pop.agents) { // the other level is behind a floor: only what is near a stair well is drawn
      if (!a.stair) { const up = a.z > zM - 0.6; if (low && up) { if (Math.hypot(a.x - cx, a.y - cy) > 16) continue; } else if (!low && !up && cz < 0.5 && Math.hypot(a.x - cx, a.y - cy) > 30) continue; }
      one(a, a.x, a.y, a.z, a.h); }
    for (const [t, O] of pop.occ) { const tr = t.train; if (!tr.group.visible) continue; const ox = t.mx + t.ux * t.c, oy = t.my + t.uy * t.c, zf = t.T.z + tr.floorY, half = tr.length / 2 + DRAW_R;
      const along = (cx - ox) * t.ux + (cy - oy) * t.uy; if (Math.abs(along) > half || Math.abs(-(cx - ox) * t.uy + (cy - oy) * t.ux) > DRAW_R) continue;
      for (const a of O.list) { if (Math.abs(a.lz - along) > DRAW_R) continue; const dx = Math.cos(a.lh), dz = Math.sin(a.lh); one(a, ox + t.ux * a.lz - t.uy * a.lx, oy + t.uy * a.lz + t.ux * a.lx, zf, Math.atan2(t.uy * dz + t.ux * dx, t.ux * dz - t.uy * dx)); } }
    D.end(); }
  // numbers for the lane's tools
  report() { const p = this.pops.get(this.S.unit), c = p ? p.counts() : {}, d = this.draw ? this.draw.stats : {}, S = this.S; let car = 0;
    if (p && S.ride) { const O = p.occ.get(S.ride.t), w = S.ride.t.train.walk.find((q) => S.ride.lz >= q.z0 - 0.3 && S.ride.lz <= q.z1 + 0.3); if (O && w) for (const a of O.list) if (a.carI === w.car) car++; }
    return Object.assign({ ready: !!(p && p.ready), cast: this.cast ? this.cast.kind : this.failed ? 'FAILED ' + this.failed : 'loading', car, paths: p ? p.paths.length : 0, lost: p ? p.lost : 0, rescues: p ? p.rescues : 0, fails: this.fails || 0, ms: +this.stats.ms.toFixed(2), navMs: this.stats.navMs }, c, p ? p.count : {}, { drawn: d.drawn || 0, near: d.near || 0, mid: d.mid || 0, far: d.far || 0, calls: d.calls || 0, tris: d.tris || 0, dropped: d.dropped || 0 }); }
}
