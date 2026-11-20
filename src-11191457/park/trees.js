// park/trees.js (park lane): the park's trees, where the lidar says they stand (chunk trees.bin: x, y, height, crown radius, species, leaf 0..1).
// The models are the street layer's generator (streets/trees_gen_next.js: makeTree, SPECIES), scaled to each tree's measured height. A park has
// thousands of trees in view, so three forms:
//   CROWN  every tree of every loaded chunk: a lumpy crown shell drawn as a dither of points of colour (leafed: November colours; bare: the grey-brown
//          haze of twigs). Far chunks have nothing else.
//   MID    trees of near chunks: + the model's low wood (trunk and main limbs), instanced per chunk.
//   NEAR   the nearest trees round the camera (a pool, refilled as the camera moves): the model's full wood and real leaves; their crown shell is hidden.
// November: leaf < 0.25 = bare; the rest turning (yellow, amber, rust, some green left), by a hash of the tree's place.
import * as THREE from 'three';
import { lit, breathe, tex } from './mat.js';
import { BASE } from './ground.js';
import { makeCards } from './cards.js';
let CARDS = null;      // the painted tree cards (cards.js); null with ?parkcards=0 = the old dithered crown shells

const NEAR_R = 46, NEAR_N = 48, PER = 6;
/* lead helper trees-rads, Nov 19 (Matt: "Trees flicker/change as you approach ... no visible swap"; second version, after merge's batch-30 critic refused the first):
   a park tree changed whole, in one frame, from its painted card to the leaf model when it came into the near pool. The pool, and how a tree in it is drawn, are
   EXACTLY as before. Only for PX_T seconds after a tree joins the pool its card stays and dissolves pixel by pixel while the model's sprays and twigs come one by one;
   a tree that leaves stays that long while the reverse happens (12 leavers at most; more, or a camera that jumped over 20 m between two pool updates, change at once as before).
   The start time rides in the instance colour: green + 2 * (q + 1), q = 1/32 s steps mod 4096; a card going is marked red + 4, a card coming red + 8; sprays going blue + 4.
   `?parkx=0` = as before. */
const PARKX = typeof location === 'undefined' || new URLSearchParams(location.search).get('parkx') !== '0', PKX = { value: 0 }, PX_T = 0.9, PX_Q = 32, PX_M = 4096, PX_OUT = 12;
const pxNow = () => (performance.now() / 1000 * PX_Q) % PX_M, pxAge = (q) => ((pxNow() - q + PX_M) % PX_M) / PX_Q;
export const PX_GLSL = `float pkxF(float g_) { float q_ = floor(g_ / 2.0) - 1.0; return clamp(mod(uPkT - q_ + ${PX_M}.0, ${PX_M}.0) / ${(PX_Q * PX_T).toFixed(1)}, 0.0, 1.0); }`;
const PX_V = PARKX ? `
          #ifdef USE_INSTANCING_COLOR
            if (instanceColor.g >= 2.0) { float f_ = pkxF(instanceColor.g); vColor.g = instanceColor.g - 2.0 * floor(instanceColor.g / 2.0);      // parkx: a tree that has just joined (or is leaving) the pool
              if (instanceColor.b >= 4.0) { vColor.b = instanceColor.b - 4.0; f_ = 1.0 - f_; }
              if (fract(aLeaf.r * 173.3 + 0.37) > f_) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
          #endif
          ` : '';
const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
let KIT = null, KITP = null;
// Near trees, Nov 17 (two rounds of blind critics: "leaves are flat triangular chips, no twigs", and the street layer's trees beside them read better).
// Cause: makeTree was called without the street layer's options, so it fell back to single-leaf meshes, and the park drew their 18-50 m band (a
// third of the leaves, each 1.95 times life size, plain triangles and kites) with a plain white material. Now the street layer's own leaf sprays
// (assets/streets/trees/sprays.json + spray_<kind>_c.webp: twigs with their leaves cut from scanned leaves, drawn alpha-cut on the generator's
// cupped cards), its out-of-round trunks with limb collars (trunk2) and its bark photograph; bare trees carry the same cards with a drawn twig
// atlas. `?parkleaf=0` = the near trees as before.
const LEAF2 = typeof location === 'undefined' || new URLSearchParams(location.search).get('parkleaf') !== '0', TD = 'assets/streets/trees/';
// Bare twigs (handoff-4): dark grey-brown set in the twig shader itself (0.012-0.052), the instance colour only varies it per tree; the far-off alpha lift is capped.
// `?parktwig=0` = the twigs as first written (pale grey-white cards); test values: a = the old alpha lift only, c = the old colour path only, ck = that with the instance colour at 0.3.
const TWIG = typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('parktwig') || '').replace('0', 'ac');
const FINE = typeof location === 'undefined' || new URLSearchParams(location.search).get('parkfine') !== '0';      // handoff-8: the near trees' fine wood (the twigs the sprays sit on); `?parkfine=0` = as before
const LEAF_SHARE = 0.5, TWIG_SHARE = 0.17;      // of a variant's sprays: leafed trees draw the first half (a half-turned November crown; 4 triangles a card), bare trees a quarter as twigs (2 a card): a pool of half bare, half leafed trees draws no more triangles than before
function twigAtlas(world) {      // 4 x 4 cells, each a forking twig growing up from the middle of the cell's lower edge (where a spray card has its base)
  const N = 1024, G = 4, C = N / G, cv = document.createElement('canvas'); cv.width = cv.height = N; const x = cv.getContext('2d'); x.clearRect(0, 0, N, N); x.lineCap = 'round'; x.strokeStyle = '#fff';
  let s = 20261117; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const br = (px, py, ang, len, w, d) => { const n = 4; let a = ang, side = R() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) { const qx = px + Math.sin(a) * len / n, qy = py - Math.cos(a) * len / n; x.lineWidth = Math.max(1.7, w * (1 - 0.5 * (i + 1) / n)); x.beginPath(); x.moveTo(px, py); x.lineTo(qx, qy); x.stroke(); px = qx; py = qy; a += (R() - 0.5) * 0.3;
      if (d > 0 && (i < n - 1 || R() < 0.5)) { br(px, py, a + side * (0.4 + R() * 0.5), len * (0.45 + R() * 0.25), w * 0.62, d - 1); side = -side; } }
    if (d > 0) br(px, py, a + (R() - 0.5) * 0.5, len * 0.55, w * 0.62, d - 1); };
  for (let cy = 0; cy < G; cy++) for (let cx = 0; cx < G; cx++) { x.save(); x.beginPath(); x.rect(cx * C + 2, cy * C + 2, C - 4, C - 4); x.clip(); br(cx * C + C / 2, (cy + 1) * C - 3, (R() - 0.5) * 0.3, C * (0.5 + R() * 0.12), 5.5, 3); x.restore(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = Math.min(8, world.renderer.capabilities.getMaxAnisotropy()); return t;
}

async function kit(game) {
  if (KIT) return KIT; if (KITP) return KITP;
  KITP = (async () => { const { makeTree, SPECIES } = await import('../streets/trees_gen_next.js'); const names = Object.keys(SPECIES), V = [];
    let SPR = null, leafM = null, twigM = null, barkT = null;
    if (LEAF2) try { SPR = await (await fetch(TD + 'sprays.json')).json(); leafM = {};
      const kinds = [...new Set(names.slice(0, PER).map((n) => SPECIES[n].spray).filter((k) => k && SPR[k]))];
      const CVP = 'attribute vec4 aLeaf; attribute vec3 aCrown; varying vec4 vLeaf; varying vec3 vCrown;' + (PARKX ? ' uniform float uPkT; ' + PX_GLSL : ''), CFP = 'varying vec4 vLeaf; varying vec3 vCrown;';
      const cut = (map, key, o) => { const m = lit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide, map, alphaTest: 0.36 }), game.world.shared, Object.assign({ key: key + (PARKX ? 'x2' : ''), uniforms: { uPkT: PKX }, night: 1.6      /* handoff-9: the sprays' dark twig and leaf colours come up at night (mat.js) */, vpars: CVP, pars: CFP,
        nbody: 'normal = normalize(vNormal);      // a card is lit by its place in the crown (the generator leans its normal outward), the same from both of its sides\n' }, o)); m.alphaToCoverage = true; m.shadowSide = THREE.DoubleSide; return m; };
      await Promise.all(kinds.map(async (k) => { const c = await tex(TD + 'spray_' + k + '_c.webp', game.world); c.wrapS = c.wrapT = THREE.ClampToEdgeWrapping; const M = SPR[k].mean, ml = (0.3 * M[0] + 0.6 * M[1] + 0.1 * M[2]).toFixed(4);
        // the scans are summer green: the picture keeps its light and dark (veins, twigs, the leaf's own shading) and takes the tree's November colour
        leafM[k] = cut(c, 'leaf2_' + k, { spec: 0.25,
          vbody: `vLeaf = aLeaf; vCrown = aCrown;
          #ifdef USE_INSTANCING
            { float fu_ = 0.62 + 0.38 * fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);      // how much of its leaf a tree still has, by its place
              if (fract(aLeaf.r * 61.7) > fu_) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
          #endif
          ` + PX_V,
          body: `vec3 tx = diffuseColor.rgb; float lm = dot(tx, vec3(0.3, 0.6, 0.1)) / ${ml};
             diffuseColor.rgb = clamp(mix(vec3(lm), vec3(tx.r / ${M[0].toFixed(4)}, tx.g / ${M[1].toFixed(4)}, lm), 0.6), 0.0, 1.8);
             float dep = clamp(length(vCrown) * 1.6, 0.0, 1.0), thru = max(0.0, dot(normalize(vWPos - cameraPosition), uSunDir));
             diffuseColor.rgb *= (0.55 + 0.6 * vLeaf.r) * mix(0.42, 1.0, smoothstep(0.25, 0.95, dep)) * mix(vec3(1.0), vec3(1.3, 1.05, 0.5), vLeaf.g);      // brightness per spray, the crown's inside in its own shade, older yellower sprays
             diffuseColor.rgb *= 1.0 + 0.7 * thru * thru * vec3(1.0, 0.9, 0.45);      // leaves between the eye and the sun glow` }); }));
      twigM = cut(twigAtlas(game.world), 'twig2', { spec: 0.15, vbody: 'vLeaf = aLeaf; vCrown = aCrown;' + PX_V,
        body: `float dd = distance(cameraPosition, vWPos); diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + ${TWIG.includes('a') ? 'dd * 0.1' : 'min(dd, 12.0) * 0.08'}));      // far off a twig is thinner than a pixel: it keeps some weight (capped at 2 times: uncapped, a card 25 m off filled in as a leaf-sized blob)
             diffuseColor.rgb = ${TWIG.includes('c') ? 'vec3(1.0)' : 'vec3(0.036, 0.029, 0.023)'} * vec3(0.7 + 0.5 * hash21(floor(vWPos.xz * 3.0) + floor(vWPos.y * 3.0))) * mix(0.6, 1.0, smoothstep(0.25, 0.95, clamp(length(vCrown) * 1.6, 0.0, 1.0)));` });
      const [bc, bn] = await Promise.all([tex(TD + 'ph_barkbrown02_diff.webp', game.world), tex(TD + 'ph_barkbrown02_nor.webp', game.world, false)]); for (const t of [bc, bn]) t.repeat.set(1, 0.55);      // the generator's bark v runs 0.55 m per unit; u is whole turns of the trunk
      barkT = [bc, bn];
    } catch (e) { console.log('[game] park: leaf sprays not loaded, the near trees as before: ' + e); SPR = null; }
    const bark = SPR ? lit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, map: barkT[0], normalMap: barkT[1] }), game.world.shared, { key: 'bark2', spec: 0.3, night: 1.8      /* handoff-9: the bark's x 0.55 comes back at night (mat.js) */,
      vpars: 'attribute vec4 aW; varying float vAO;', vbody: 'vAO = aW.r;', pars: 'varying float vAO;',
      body: `diffuseColor.rgb *= 0.55 * mix(0.6, 1.0, vAO) * (0.8 + 0.4 * vnoise(vWPos.xz * 0.4));      // the street trees' bark photograph, darker inside the crown (the generator's occlusion)` })
    : lit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 }), game.world.shared, { key: 'bark', spec: 0.3,
      body: `float ba = atan(vWN.z, vWN.x) * 6.0 + vWPos.x * 3.0, bn = fbm(vec2(ba, vWPos.y * 1.1) * 3.0), fur = smoothstep(0.35, 0.6, vnoise(vec2(ba * 5.0, vWPos.y * 2.2)));      // ridges running up the trunk, dark furrows between
             diffuseColor.rgb = mix(vec3(0.020, 0.017, 0.014), vec3(0.075, 0.066, 0.055), bn * (0.45 + 0.55 * fur)) * (0.75 + 0.5 * vnoise(vWPos.xz * 0.4));` });
    { const obc = bark.onBeforeCompile; bark.onBeforeCompile = (sh, r) => { obc(sh, r);      // the foot of the trunk flares into the ground in five uneven roots
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n { float fl = exp(-max(transformed.y, 0.0) / 0.5), an = atan(transformed.z, transformed.x); transformed.xz *= 1.0 + fl * (0.55 + 0.3 * sin(an * 5.0 + 1.3)); }'); }; }
    const leaf = lit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }), game.world.shared, { key: 'leaf', spec: 0.25,
      body: `float back = clamp(dot(uSunDir, bakeN) * (gl_FrontFacing ? 1.0 : -1.0), -1.0, 1.0); diffuseColor.rgb *= 0.8 + 0.5 * hash21(floor(vWPos.xz * 7.0) + floor(vWPos.y * 7.0)); diffuseColor.rgb *= back < 0.0 ? vec3(1.35, 1.25, 0.8) : vec3(1.0);` });
    for (let k = 0; k < Math.min(PER, names.length); k++) { const S = SPECIES[names[k]], SP = SPR && S.spray && SPR[S.spray] && leafM[S.spray] ? S.spray : null, t = makeTree(S, 11 + k * 7, SP ? { sprays: SPR, trunk2: true } : undefined), w = t.wood, CD = !!(SP && t.info.cards), lf = t.leaves[CD ? 0 : Math.min(1, t.leaves.length - 1)];
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(w.pos, 3)); wg.setAttribute('normal', new THREE.BufferAttribute(w.nrm, 3)); wg.setIndex(new THREE.BufferAttribute(w.idx, 1)); wg.userData.shared = true;
      if (SPR) { wg.setAttribute('uv', new THREE.BufferAttribute(w.uv, 2)); wg.setAttribute('aW', new THREE.BufferAttribute(w.col, 4, true)); }
      if (CD) {      // the sprays: any prefix of the generator's cards is an even sample of the crown (it shuffles them); each card is 3 x 3 vertices
        // the share is set so the sprays would cover the crown's side about 2.2 times over (a wide crown of small sprays gets more of its cards, a narrow dense one fewer)
        const SM = SPR[SP], lay = lf.leaves * LEAF_SHARE * Math.pow((S.sprayLen || 1) * SM.cell_m, 2) * (SM.cover || 0.22) / (Math.PI * (t.info.radius || S.crownR) * 0.45 * t.info.hi[1]), sh = Math.max(0.3, Math.min(0.8, LEAF_SHARE * 2.2 / lay));
        const nl = Math.floor(lf.leaves * sh), nt = Math.floor(lf.leaves * sh * TWIG_SHARE / LEAF_SHARE), li = new Uint32Array(nl * 12), ti = new Uint32Array(nt * 6);
        for (let i = 0; i < nl; i++) { const b = i * 9; li.set([b, b + 1, b + 7, b, b + 7, b + 6, b + 1, b + 2, b + 8, b + 1, b + 8, b + 7], i * 12); }      // two quads folded along the spray's middle
        for (let i = 0; i < nt; i++) { const b = i * 9; ti.set([b, b + 2, b + 8, b, b + 8, b + 6], i * 6); }
        const mk = (ix) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', aP); g.setAttribute('normal', aN); g.setAttribute('uv', aU); g.setAttribute('aLeaf', aL); g.setAttribute('aCrown', aC); g.setIndex(new THREE.BufferAttribute(ix, 1)); g.userData.shared = true; return g; };
        const nv = nl * 9, aP = new THREE.BufferAttribute(lf.pos.subarray(0, nv * 3), 3), aN = new THREE.BufferAttribute(lf.nrm.subarray(0, nv * 4), 4, true), aU = new THREE.BufferAttribute(lf.uv.subarray(0, nv * 2), 2), aL = new THREE.BufferAttribute(lf.col.subarray(0, nv * 4), 4, true), aC = new THREE.BufferAttribute(lf.crw.subarray(0, nv * 3), 3, true);
        const full = wg.clone(); full.userData.shared = true; full.setDrawRange(0, w.cuts[1] || w.cuts[0] || w.idx.length);
        // handoff-8 (critic r3: "loose leaf clumps floating in the sky"): `full` stops at the generator's cut 1 (wood under 1.1 cm), a quarter to a third of the near
        // wood, but the sprays grow on the outer branches: measured, a spray's foot stood a median 0.4-0.7 m (up to 3 m; times the tree's scale) from the nearest
        // drawn wood, 3 cm from the whole near wood. The rest of the near wood (cut 1 .. the far block's start) is drawn as a second mesh that casts no shadow.
        let fine = null; if (FINE && w.cuts[1] && w.cuts[0] > w.cuts[1]) { fine = new THREE.BufferGeometry(); for (const a in full.attributes) fine.setAttribute(a, full.attributes[a]); fine.setIndex(full.index); fine.userData.shared = true; fine.setDrawRange(w.cuts[1], w.cuts[0] - w.cuts[1]); fine.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S.H * 0.55, 0), S.H * 0.8); }
        const low = wg; if (w.far && w.far[1] > 0) low.setDrawRange(w.far[0], w.far[1]); else low.setDrawRange(0, Math.min(w.idx.length, w.cuts[3] || w.idx.length));
        const lg = mk(li), tg = mk(ti);
        for (const g of [full, low, lg, tg]) { g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S.H * 0.55, 0), S.H * 0.8); }
        V.push({ name: names[k], H: t.info.hi ? t.info.hi[1] : S.H, R: t.info.radius || S.crownR, full, fine, low, leaves: lg, twigs: tg, leafMat: leafM[SP], tris: { full: full.drawRange.count / 3 + (fine ? '+' + fine.drawRange.count / 3 : ''), low: low.drawRange.count / 3, leaves: li.length / 3 + '+' + ti.length / 3 } });
        await breathe(); continue; }
      const full = wg.clone(); full.userData.shared = true; full.setDrawRange(0, w.cuts[1] || w.cuts[0] || w.idx.length);
      const low = wg; if (w.far && w.far[1] > 0) low.setDrawRange(w.far[0], w.far[1]); else low.setDrawRange(0, Math.min(w.idx.length, w.cuts[3] || w.idx.length));
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lf.pos, 3)); lg.setAttribute('normal', new THREE.BufferAttribute(lf.nrm, 4, true)); lg.setIndex(new THREE.BufferAttribute(lf.idx, 1)); lg.userData.shared = true;
      for (const g of [full, low, lg]) { g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S.H * 0.55, 0), S.H * 0.8); }
      V.push({ name: names[k], H: t.info.hi ? t.info.hi[1] : S.H, R: t.info.radius || S.crownR, full, low, leaves: lg, tris: { full: full.drawRange.count / 3, low: low.drawRange.count / 3, leaves: lf.idx.length / 3 } });
      await breathe(); }
    // the crown shell: a lumpy unit sphere, centre at the origin, radius 1
    const cg = new THREE.IcosahedronGeometry(1, 3), p = cg.attributes.position, nn = new Float32Array(p.count * 3); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.80 + 0.16 * Math.sin(x * 5.1 + y * 3.3) * Math.cos(z * 4.7 - y * 2.1) + 0.12 * Math.sin(x * 11.0 - z * 9.0 + y * 13.0); nn[i * 3] = x; nn[i * 3 + 1] = y * 0.6 + 0.4; nn[i * 3 + 2] = z; p.setXYZ(i, x * n, y * n * (y < 0 ? 0.7 : 1), z * n); } cg.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); cg.userData.shared = true;      /* smooth normals leaning up: a mass of foliage lit from the sky, never facets */
    const crown = (dens, key, rim) => lit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), game.world.shared, { key, spec: 0,
      vpars: 'varying vec3 vLoc;', vbody: 'vLoc = position;', pars: 'varying vec3 vLoc;',
      body: `pkSide = pkAgainstSun(0.3); float dd = distance(cameraPosition, vWPos), cs = clamp(dd / 260.0, 0.07, 1.6);      // the dither's grain grows with distance so it does not shimmer
             vec3 cq = floor(vWPos / cs); float hv = fract(sin(dot(cq, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
             float inner = gl_FrontFacing ? 1.0 : 0.55, rim = abs(dot(normalize(vWN), normalize(cameraPosition - vWPos))), lump = vnoise(vLoc.xz * 4.0 + vLoc.y * 3.0);
             if (hv > ${dens} * inner * mix(1.0, 1.25, smoothstep(40.0, 300.0, dd)) * smoothstep(0.02, ${rim}, rim + (lump - 0.5) * 0.5)) discard;      // thin and ragged towards the outline: sky shows through the edge of a crown
             diffuseColor.rgb *= (0.7 + 0.45 * fract(hv * 7.31)) * (0.75 + 0.5 * lump) * mix(0.5, 1.05, smoothstep(-0.6, 0.8, vLoc.y)) * (gl_FrontFacing ? 1.0 : 0.6);` });
    if (typeof location === 'undefined' || new URLSearchParams(location.search).get('parkcards') !== '0') CARDS = await makeCards(game, PARKX ? { u: PKX, glsl: PX_GLSL } : null);
    KIT = { V, bark, leaf, twigM, crownGeo: cg, crownLeaf: crown('0.86', 'crownL', '0.55'), crownBare: crown('0.20', 'crownB', '0.9'), names };
    console.log('[game] park: tree kit: ' + V.map((v) => v.name + ' ' + v.tris.full + '/' + v.tris.low + '/' + v.tris.leaves).join(', '));
    return KIT; })();
  return KITP;
}
// November colour of a leafed tree (linear rgb), by place
let SPC = [];      // the data's species: [{ name, leaf, colour '#rrggbb' }] -> linear rgb of the November leaf
export function setSpecies(info) { SPC = (info || []).map((o) => (o && o.colour ? new THREE.Color(o.colour) : null)); }
const PAL = [[0.20, 0.115, 0.028], [0.16, 0.068, 0.022], [0.105, 0.06, 0.03], [0.085, 0.085, 0.03], [0.21, 0.14, 0.04], [0.13, 0.05, 0.02]];      // ochre, rust, brown, dull olive, straw, oxblood
const autumn = (t, out) => { const h = hash(t.x, t.y), g = hash(t.y * 1.7, t.x * 0.3), a = PAL[Math.floor(h * PAL.length) % PAL.length], k = 0.75 + 0.5 * g, c = SPC[t.sp];
  if (c) { const m = 0.55 + 0.25 * hash(t.x * 0.7, t.y * 1.3); const s = 0.30 * Math.min(1, 0.16 / Math.max(0.01, 0.30 * Math.max(c.r, c.g, c.b)));      /* look pass k1: a pale species colour (cream, pink) is held to the palette's brightness */ return out.setRGB((c.r * s * (1 - m) + a[0] * m) * k, (c.g * s * (1 - m) + a[1] * m) * k, (c.b * s * (1 - m) + a[2] * m) * k); }      // the species' own colour (a leaf in the mass reads darker than the single leaf), a little of the place's mix
  return out.setRGB(a[0] * k, a[1] * k, a[2] * k); };
const BARE = new THREE.Color(0.034, 0.028, 0.024), LEAFED = 0.42;      // a tree whose `leaf` is under LEAFED stands bare (mid November: about half)

// read a chunk's trees; drop those standing in a path or drive (the lidar's crown top can lie over one)
export function parse(buf, paths, W = 8) {      // W floats per tree: 8 in the data (SCHEMA.md: x, y, height, crown radius, species, leaf, trunk diameter, src), 6 in the test park
  const f = new Float32Array(buf), n = Math.floor(f.length / W), out = [];
  const segs = []; for (const p of paths || []) { if (!p.pts || p.tunnel) continue; const hw = (p.w || 3) / 2 + 0.2; for (let k = 0; k + 1 < p.pts.length; k++) segs.push([p.pts[k][0], p.pts[k][1], p.pts[k + 1][0], p.pts[k + 1][1], hw]); }
  for (let k = 0; k < n; k++) { const x = f[k * W], y = f[k * W + 1]; let bad = false;
    for (const s of segs) { if (x < Math.min(s[0], s[2]) - s[4] || x > Math.max(s[0], s[2]) + s[4] || y < Math.min(s[1], s[3]) - s[4] || y > Math.max(s[1], s[3]) + s[4]) continue; const dx = s[2] - s[0], dy = s[3] - s[1], t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t) < s[4]) { bad = true; break; } }
    if (!bad) out.push({ x, y, h: Math.max(3, f[k * W + 2]), r: Math.max(1.2, f[k * W + 3]), sp: f[k * W + 4] | 0, leaf: f[k * W + 5], dbh: W > 6 ? f[k * W + 6] : 0 }); }
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const variant = (K, t) => K.V[(t.sp + Math.floor(hash(t.x, t.y) * 3)) % K.V.length];
const woodM = (K, t, z) => { const v = variant(K, t), sy = t.h / v.H, sx = Math.min(sy * 1.35, Math.max(sy * 0.7, t.r / v.R)); _e.set(0, hash(t.y, t.x) * 6.283, 0); _q.setFromEuler(_e); _v.set(t.x, z, -t.y); _s.set(sx, sy, sx); return _m.compose(_v, _q, _s); };
const crownM = (t, z) => { if (CARDS) { _e.set(0, hash(t.x, t.y) * 6.283, 0); _q.setFromEuler(_e); _v.set(t.x, z, -t.y); const w = Math.max(t.r, t.h * 0.2) * CARDS.SX * 1.08; _s.set(w, t.h * CARDS.SY, w); return _m.compose(_v, _q, _s); } const ch = t.h * 0.62, cy = z + t.h - ch * 0.5; _e.set(0, hash(t.x, t.y) * 6.283, 0); _q.setFromEuler(_e); _v.set(t.x, cy, -t.y); _s.set(t.r * 1.05, ch * 0.5, t.r * 1.05); return _m.compose(_v, _q, _s); };

// a card's own instance colour (as crowns() sets it)
const cardCol = (t, out) => (t.leaf >= LEAFED ? autumn(t, out).multiplyScalar(0.55) : out.setRGB(0.17, 0.15, 0.135).multiplyScalar(0.8 + 0.4 * hash(t.x, t.y)));
// crowns(game, trees) -> group with two instanced meshes (leafed, bare); each tree gets .ci = [mesh, index]
export async function crowns(game, trees) {
  const K = await kit(game), T = game.terrain, g = new THREE.Group(); g.name = 'park_crowns';
  const A = trees.filter((t) => t.leaf >= LEAFED), B = trees.filter((t) => t.leaf < LEAFED);
  for (const [L, mat, leafed] of [[A, K.crownLeaf, true], [B, K.crownBare, false]]) { if (!L.length) continue; const im = new THREE.InstancedMesh(CARDS ? (leafed ? CARDS.geoLeaf : CARDS.geoBare) : K.crownGeo, CARDS ? (leafed ? CARDS.matLeaf : CARDS.matBare) : mat, L.length); im.name = leafed ? 'park_crown_leaf' : 'park_crown_bare';
    L.forEach((t, k) => { t.z = BASE + T.ground(t.x, t.y) - 0.15; im.setMatrixAt(k, crownM(t, t.z)); im.setColorAt(k, leafed ? autumn(t, _c).multiplyScalar(CARDS ? 0.55 : 1)      /* look pass k1: the far crowns stood cream and pink in sun (still c): a card's dabs are up to white, so its colour is 0.55 of the leaf's */ : (CARDS ? _c.setRGB(0.17, 0.15, 0.135)      /* critic r1, Nov 16: bare crowns drew as cream-white puffballs in sun (was 0.36, 0.33, 0.30) */ : _c.copy(BARE)).multiplyScalar(0.8 + 0.4 * hash(t.x, t.y))); t.ci = [im, k]; });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = leafed || !!CARDS; g.add(im); }
  return g;
}
// mid(game, trees) -> group: low wood per variant; each tree gets .wi = [mesh, index]. The caller adds the trunk circles (this function yields).
export async function mid(game, trees) {
  const K = await kit(game), g = new THREE.Group(); g.name = 'park_wood'; const by = new Map();
  for (const t of trees) { const v = variant(K, t); let a = by.get(v); if (!a) by.set(v, (a = [])); a.push(t); }
  for (const [v, L] of by) { const im = new THREE.InstancedMesh(v.low, K.bark, L.length); im.name = 'park_wood_' + v.name; L.forEach((t, k) => { im.setMatrixAt(k, woodM(K, t, t.z)); t.wi = [im, k]; });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = true; g.add(im); await breathe(); }
  return g;
}

// the near pool: one per game. update(cx, cy, lists) with lists = the tree arrays of the near chunks
export function nearPool(game, parent) {
  const P = { on: new Set(), meshes: null, n: 0, out: new Set(), cx: 1e9, cy: 1e9 }, PX = PARKX && typeof requestAnimationFrame !== 'undefined', CAP = NEAR_N + (PX ? PX_OUT : 0);
  if (PX) { const tk = () => { PKX.value = pxNow(); requestAnimationFrame(tk); }; requestAnimationFrame(tk); }
  const card = (t, mode) => { if (!t.ci || !t.ci[0].parent) return; const im = t.ci[0], k = t.ci[1]; im.setMatrixAt(k, mode === 'off' ? ZERO : crownM(t, t.z)); im.instanceMatrix.needsUpdate = true;      // parkx: mode 'off' | 'plain' | 'go' | 'come'
    if (im.instanceColor && mode !== 'off') { cardCol(t, _c); if (mode !== 'plain') { _c.r += mode === 'go' ? 4 : 8; _c.g += 2 * (t.pq + 1); } im.setColorAt(k, _c); im.instanceColor.needsUpdate = true; } };
  const mark = (t, c) => { if (t.px === 1 || t.px === 3) { c.g += 2 * (t.pq + 1); if (t.px === 3) c.b += 4; } return c; };
  P.update = async (cx, cy, lists) => { const K = await kit(game);
    if (!P.meshes) { P.meshes = K.V.map((v) => { const w = new THREE.InstancedMesh(v.full, K.bark, CAP), l = new THREE.InstancedMesh(v.leaves, v.leafMat || K.leaf, CAP), b = v.twigs && K.twigM ? new THREE.InstancedMesh(v.twigs, K.twigM, CAP) : null, f = v.fine ? new THREE.InstancedMesh(v.fine, K.bark, CAP) : null; for (const m of [w, l, b, f]) { if (!m) continue; m.count = 0; m.castShadow = m !== b && m !== f; m.receiveShadow = true; m.frustumCulled = false; parent.add(m); } w.name = 'park_near_wood'; l.name = 'park_near_leaves'; if (b) b.name = 'park_near_twigs'; if (f) f.name = 'park_near_fine'; return { w, l, b, f }; }); }
    const cand = []; for (const L of lists) for (const t of L) { const d = (t.x - cx) * (t.x - cx) + (t.y - cy) * (t.y - cy); if (d < NEAR_R * NEAR_R && t.wi) cand.push([d, t]); }
    cand.sort((a, b) => a[0] - b[0]); const now = new Set(cand.slice(0, NEAR_N).map((c) => c[1]));
    const PXC = PX && !!CARDS, jump = Math.hypot(cx - P.cx, cy - P.cy) > 20, q0 = Math.floor(pxNow()); P.cx = cx; P.cy = cy; let chg = false;
    if (PXC) {      // parkx: hand-overs that have run their time; trees back in the pool; (with a jump: everything at once, as before)
      for (const t of [...P.out]) if (now.has(t) || jump || pxAge(t.pq) >= PX_T) { P.out.delete(t); chg = true; if (!now.has(t)) { t.px = 0; card(t, 'plain'); if (t.wi && t.wi[0].parent) { t.wi[0].setMatrixAt(t.wi[1], woodM(K, t, t.z)); t.wi[0].instanceMatrix.needsUpdate = true; } } }
      for (const t of P.on) if (t.px === 1 && (jump || pxAge(t.pq) >= PX_T)) { t.px = 2; card(t, 'off'); chg = true; } }
    let same = !chg && now.size === P.on.size; if (same) for (const t of now) if (!P.on.has(t)) { same = false; break; } if (same) return;
    if (PXC) for (const t of P.on) if (!now.has(t)) { if (jump || P.out.size >= PX_OUT) { t.px = 0; card(t, 'plain'); if (t.wi && t.wi[0].parent) { t.wi[0].setMatrixAt(t.wi[1], woodM(K, t, t.z)); t.wi[0].instanceMatrix.needsUpdate = true; } } else { t.px = 3; t.pq = q0; card(t, 'come'); P.out.add(t); } }
    if (!PXC) for (const t of P.on) if (!now.has(t)) { if (t.ci && t.ci[0].parent) { t.ci[0].setMatrixAt(t.ci[1], crownM(t, t.z)); t.ci[0].instanceMatrix.needsUpdate = true; } if (t.wi && t.wi[0].parent) { t.wi[0].setMatrixAt(t.wi[1], woodM(K, t, t.z)); t.wi[0].instanceMatrix.needsUpdate = true; } }
    for (const m of P.meshes) { m.w.count = 0; m.l.count = 0; if (m.b) m.b.count = 0; if (m.f) m.f.count = 0; }
    if (PXC) for (const t of now) if (!P.on.has(t)) { if (jump) { t.px = 2; card(t, 'off'); } else { t.px = 1; t.pq = q0; card(t, 'go'); } }      // parkx: a tree that joins keeps its card for PX_T seconds
    const draw = PXC && P.out.size ? [...now, ...P.out] : now;
    for (const t of draw) { const vi = K.V.indexOf(variant(K, t)), m = P.meshes[vi]; woodM(K, t, t.z); m.w.setMatrixAt(m.w.count++, _m); if (m.f) m.f.setMatrixAt(m.f.count++, _m);
      if (t.leaf >= LEAFED) { m.l.setMatrixAt(m.l.count, _m); m.l.setColorAt(m.l.count++, mark(t, autumn(t, _c))); }
      else if (m.b) { m.b.setMatrixAt(m.b.count++, _m); (TWIG.includes('c') ? _c.setRGB(0.070, 0.058, 0.049).multiplyScalar(TWIG.includes('k') ? 0.3 : 1) : _c.setRGB(1, 1, 1)).multiplyScalar(0.8 + 0.4 * hash(t.x, t.y)); m.b.setColorAt(m.b.count - 1, mark(t, _c)); }      // a bare tree's fine twigs
      if (!P.on.has(t) && !P.out.has(t)) { if (!PXC && (CARDS || t.leaf >= LEAFED) && t.ci) { t.ci[0].setMatrixAt(t.ci[1], ZERO);      /* a near tree is its model: its card (or leafed shell) is not drawn */ t.ci[0].instanceMatrix.needsUpdate = true; } t.wi[0].setMatrixAt(t.wi[1], ZERO); t.wi[0].instanceMatrix.needsUpdate = true; } }
    for (const m of P.meshes) { m.w.instanceMatrix.needsUpdate = true; if (m.f) m.f.instanceMatrix.needsUpdate = true; m.l.instanceMatrix.needsUpdate = true; if (m.l.instanceColor) m.l.instanceColor.needsUpdate = true; if (m.b) { m.b.instanceMatrix.needsUpdate = true; if (m.b.instanceColor) m.b.instanceColor.needsUpdate = true; } }
    P.on = now; P.n = now.size; };
  P.forget = (trees) => { for (const t of trees) { P.on.delete(t); P.out.delete(t); t.px = 0; } };
  return P;
}
