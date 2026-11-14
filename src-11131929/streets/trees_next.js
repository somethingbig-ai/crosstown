// trees.js (streets lane, part: trees): street and park trees with real leaf geometry, replacing the lead's card trees
// (propMeshes kinds 'tree' and 'tree2', which are hidden). Every leaf is its own small folded mesh set on a twig; no alpha cards.
// Rules, all keyed by a hash of the tree's map position:
//   species   street: London plane / honey locust / callery pear, planted in runs (one species leads each ~70 m cell);
//             sidewalks with a wall closer than 2.3 m get the narrow pear. Parks: big planes, broad elms/oaks, some locust; park trees are moved off
//             the planting grid (up to 3.5 m), one in eight is left out, one in eight is a young tree.
//   form      12 seeded models (trees_gen.js), each tree with its own size, height stretch, lean, turn and colour (some yellowing);
//             the crown is squeezed across the street where a building wall is near.
//   bands     full leaves < 18 m, 1/2.5 of the leaves 1.66x larger to 55 m, 1/4 as 2-triangle leaves 2.15x to 180 m, 1/11 at 3.7x beyond.
//             Bands are re-sorted when the camera moves (instance buffers); trees out of view (grown by the reach of their shadow) are dropped.
//   light     leaves use a normal mixed from the leaf's own and the crown's, so a crown has a lit and a shaded side; a leaf lit from
//             behind is shaded as transmitting (yellow-green, still under the shadow map); a baked occlusion value per leaf darkens
//             the inside of the crown; beyond the shadow map a stand-in from the same data takes over (with the ground bake).
//   pits      street trees stand in a soil pit: relief, dry and wet soil, crumbs, mulch, weeds, butts and scraps; the shader heaps the
//             soil against that tree's own trunk to an uneven line with a dark crease. Rim: granite lengths or setts, low and uneven.
//             Six in ten have a low three-sided iron guard (rail or hoop); four in ten of those are planted. A soft dirt apron lies
//             on the paving around each pit. No pit where a tree at a park's edge stands on the grass (a short pit if it stands on paving); no street tree within 12 m of a signal pole.
import * as THREE from 'three';
const V2_DEFAULT = true;   // round 9: spray-card crowns, the trunk's own root flare, sunk pits; ?trees2=1 / ?trees2=0
import { BAKE_LIGHT_GLSL, NOISE_GLSL } from '../facade.js';
import { makeTree, SPECIES, rng } from './trees_gen_next.js';

const LOD_D = [13, 42], LOD_CARD = [19, 44];   // spray-card crowns are a fifth of the triangles, so their full band reaches further
const V2 = typeof location !== 'undefined' && /[?&]trees2=1/.test(location.search) ? true : typeof location !== 'undefined' && /[?&]trees2=0/.test(location.search) ? false : V2_DEFAULT;
const BED = typeof location !== 'undefined' && /[?&]chipbed=1/.test(location.search);   // round 16: the hero pits' mulch as a pile of real chips: judged worse than the traced mulch (93/96, closeness 30 against 44), so off; ?chipbed=1 on
const WC3 = typeof location === 'undefined' || !/[?&]treesfull=1/.test(location.search) || !/[?&]mulch=(old|path)/.test(location.search);   // kept in round 28 (closeness 44 against 36); ?mulch=old = the Poly Haven scan   // round 28: the mulch is another scan (ambientCG WoodChips003: coarse fresh arborist chips with bark), in its own colour, with its own relief and occlusion maps
const FRINGE = typeof location !== 'undefined' && /[?&]fringe=1/.test(location.search);   // round 28: the cut-out sprays are drawn a second time as a blended one-pixel fringe outside their hard edge (soft leaf edges without multisampling)
const LODFADE = typeof location === 'undefined' || !/[?&]lodfade=0/.test(location.search);   // default on from round 28 (seen on pod frames w58..w38: the crown changes over a metre of walking, no pop)
const LODFADE_OLD = typeof location !== 'undefined' && /[?&]lodfade=1/.test(location.search);   // round 28: the scan tree's bands hand over piece by piece across a metre or so of walking (twigs <-> sprays at 4.0-5.4 m, sprays <-> thinned sprays at 8.0-9.6 m) instead of the whole crown changing at once
const BARK2 = typeof location === 'undefined' || !/[?&]bark=1/.test(location.search);   // kept in round 28 with the mulch; ?bark=1 = the scan's own bark   // round 28: the scan tree's trunk and limbs wear a photographed bark at the tree's real size (Poly Haven Bark Willow 02, laid from three sides in world metres), not the young scan's own bark blown up two times
const BACK = typeof location !== 'undefined' && /[?&]back=1/.test(location.search);   // round 28: leaves lit from behind stay a saturated yellow-green instead of burning out to white
const BK = typeof location !== 'undefined' ? (parseFloat((/[?&]barkk=([0-9.]+)/.exec(location.search) || [])[1]) || 1.0).toFixed(2) : '1.00';   // round 30: the photographed bark darker (a street tree's bark is dark grey-brown, ours read pale grey in the sun)
const GLOSS = typeof location !== 'undefined' && /[?&]gloss=1/.test(location.search);   // round 30: the near leaves' waxy face glints: a share of the leaves near white in the sun, as in a photograph
const NET = typeof location === 'undefined' || !/[?&]twignet=0/.test(location.search);   // default on from round 33 (at or above kept five sittings running: +8, +1, +5, +3, +4; no fps cost resolved on the M2 Pro or the M1 Pro); ?twignet=0 = before.   // round 30: a grown tier of thin real twigs from the scan's limbs out to its leaves (tools/trees_mktwignet.py)
const PHOTO = false;   // OUT (rounds 30-32: 27-30 against kept 41-44; files moved to items/trees/out-assets/, not in the game's assets). Was ?mulch=photo|sun:   // round 30: the mulch is a PHOTOGRAPH of mulch (Commons, CC BY-SA 4.0), keeping the real shade between its pieces
const SUNM = false;   // OUT with it. Was ?mulch=sun:   // round 31: a photograph taken in hard sun (every piece with its own highlight and cast shadow), turned in each pit so the photo's sun is the game's sun
const TSHADOW = typeof location === 'undefined' || !/[?&]tshadow=0/.test(location.search);   // default on from round 33 (closeness 37 / 40 against 28 / 30, pod, same sitting); ?tshadow=0 = before   // round 33: the trunk's hard shadow carried on over the paving past the pit's edge (the lowest 1.5 m of a street trunk is not in the shadow map: its shadow stopped dead at the pit)
const FARFIX = typeof location === 'undefined' || !/[?&]farfix=0/.test(location.search);   // Nov 12 (release ask): mid and far crowns standing in building shade keep the sky's light (they drew near-black: the crown's own occlusion took the sky light to a tenth, then the street's bake took it again); ?farfix=0 = as before
const BARKALL = typeof location !== 'undefined' && /[?&]barkall=1/.test(location.search);   // round 32: the photographed bark on the limbs too (the scan's own limb bark read soft and blurred from under the tree)
const CRISP = typeof location !== 'undefined' && /[?&]crisp=1/.test(location.search);   // round 32: the gaps between the chips really dark (deep shade between pieces, as a photograph in hard sun shows)
const CLUMP = typeof location !== 'undefined' && /[?&]clump=1/.test(location.search);   // round 31: the crown in masses and gaps: leaves taken out where a slow 3D noise is low (a few stragglers stay), so foliage gathers in clumps with sky between
const GNARL = typeof location !== 'undefined' && /[?&]gnarl=1/.test(location.search);   // round 31: the scan's limbs made lumpy (knots, swellings at forks) by moving the mesh itself: no more even tubes
const hsh3 = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
const n3 = (x, y, z) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz); let r = 0;
  for (let k = 0; k < 8; k++) { const a = k & 1, b = (k >> 1) & 1, c = (k >> 2) & 1; r += hsh3(xi + a, yi + b, zi + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w); } return r; };
const SEAT = typeof location !== 'undefined' && /[?&]seat=1/.test(location.search);   // round 31: the trunk goes down into level mulch: no chips painted up the bark, no cone heaped at the foot; damp dark bark at the ground, a hard dense trunk shadow
const NETR = typeof location !== 'undefined' ? (parseFloat((/[?&]netr=([0-9.]+)/.exec(location.search) || [])[1]) || 0) : 0;   // round 31: the grown twigs thicker by this many metres of radius (scan units)
const GEOFAR = typeof location !== 'undefined' && /[?&]geofar=1/.test(location.search);   // round 35: real single-leaf meshes out to 24 m (levels 1 and 2 of the scan's leaf meshes) instead of cut-out grids from 4.6 m
const SPECFADE = typeof location !== 'undefined' && /[?&]specfade=1/.test(location.search);   // round 35 (camera lane: leaf-edge speckle): the leaf cards' sun glint fades with distance (a card a pixel or two wide cannot hold a highlight still) and is capped
const PLANE = typeof location !== 'undefined' && /[?&]bark=plane/.test(location.search);   // round 35: the scan tree's trunk and limbs wear a photographed London-plane bark (patchwork of flaking plates: brown old plates standing proud of olive and cream), with the plates' relief and the shade at their edges; &pk= brightness (0.42), &pt= metres a tile across (0.36)
const LATE = typeof location !== 'undefined' && typeof document !== 'undefined' && !/[?&]late=0/.test(location.search);   // default on from Nov 12 16:xx (pod frames after load the same as before); ?late=0 = everything before first paint   // Nov 12 (first load on weak machines): pictures only a tree within a few metres shows (the scan's bark and leaf relief, the photographed trunk bark, the boughs' wood, the mulch) are fetched after the page is ready; a flat stand-in colour until then
const qnum = (k, d) => typeof location !== 'undefined' ? (parseFloat((new RegExp('[?&]' + k + '=([0-9.]+)').exec(location.search) || [])[1]) || d) : d;
const WOODK = qnum('woodk', 1.0).toFixed(3), WOODG = qnum('woodg', 1.0).toFixed(3), WOODI = qnum('woodi', 1.0).toFixed(3);   // round 35: the scan tree's bark tone (times, contrast power about 0.1, share of the sky/bounce light kept)
const PK = qnum('pk', 0.42).toFixed(3), PT = qnum('pt', 0.36).toFixed(3);
const MG = PHOTO ? qnum('mg', SUNM ? 0.28 : 0.5).toFixed(2) : '1.00', MSV = qnum('ms', SUNM ? 0.75 : 1.8).toFixed(2), MK = (PHOTO ? (SUNM ? 'u' : 'f') + MG + '_' + MSV : '') + (SEAT ? 's' : '') + (CRISP ? 'c' : '');
const TRK2 = typeof location !== 'undefined' && !/[?&]trunk2=0/.test(location.search);   // Nov 13 (Matt 22:47 Nov 12, "smooth trunks", city-wide): every GENERATED trunk and limb wears the photographed bark of the hero trunks (Poly Haven bark_willow_02: colour, relief, furrow shade, at real size from three sides), and the generator gives it an out-of-round trunk, a swelling under the fork and a collar at each limb joint
const PITALL = typeof location !== 'undefined' && !/[?&]pitall=0/.test(location.search);   // Nov 13 (Matt 22:47 Nov 12, "white tree pits", city-wide): EVERY street tree stands in the sunk mulch pit of the hero blocks (hole in the paving, dark soil and chips, worn cut edge), not in the flat pit with the pale stone rim
const PDK = [qnum('pdk', 0.42) * 1.0, qnum('pdk', 0.42) * 0.92, qnum('pdk', 0.42) * 0.86].map((v) => v.toFixed(3));
const TRKN = qnum('trkn', 2.4).toFixed(2), TRKK = qnum('trkk', 1.15).toFixed(2), TRKT = qnum('trkt', 0.75).toFixed(2);
const PIT3 = typeof location !== 'undefined' && /[?&]pit3=1/.test(location.search);   // round 29: a hard-edged, dense trunk shadow over the mulch, a firm dark contact at the bark, dark rotted pieces and soil showing between the chips
const MDARK = typeof location !== 'undefined' && /[?&]mdark=1/.test(location.search);   // round 27: the mulch a quarter darker and browner (at the street's exposure it bleached to straw)
const BIG = typeof location !== 'undefined' && /[?&]big=1/.test(location.search);   // round 27: the near twigs and their leaves a quarter larger
const TONE = typeof location !== 'undefined' && /[?&]tone=1/.test(location.search);   // round 26: the real mulch pieces in orange-browns, dark damp and weathered tones as well as straw, lying a little higher so each throws more shade
const DEEP = typeof location !== 'undefined' && /[?&]deep=1/.test(location.search);   // round 24: the near crown's shaded leaves really dark, so the crown has a lit shell and a dark inside
const SLABS3 = typeof location === 'undefined' || !/[?&]slabs3=0/.test(location.search);   // kept in round 24 (closeness 40 against 36)   // round 24: two and a half times as many real pieces on the mulch
const FLARE = typeof location !== 'undefined' && /[?&]flare=1/.test(location.search);   // round 23: the scan trunk's foot spreads into a root flare (three uneven buttresses), drawn out in the vertex shader
const EDGE = typeof location !== 'undefined' && /[?&]edge=1/.test(location.search);   // round 23: a steel edging with real thickness round each hero pit
const GLOW = typeof location !== 'undefined' && /[?&]glow=1/.test(location.search);   // round 22: stronger, yellower light through the near leaves
const BASE2 = typeof location === 'undefined' || !/[?&]base=0/.test(location.search);   // kept in round 22 (blind 88, closeness 45 against 41)   // round 22: mulch heaped higher against the trunk, a softer contact line
const DENSE = typeof location !== 'undefined' && /[?&]var=1/.test(location.search);   // round 25: twigs whose leaves hang and turn more and range wider in size (scan_small02d.*)
const DENSE0 = false;   // (round 21: the kept file now holds the twig crown with 95% of the scan's leaf-bearing pieces: closeness 34 against 30)
const SLABS = typeof location === 'undefined' || !/[?&]slabs=0/.test(location.search);   // kept in round 20 (closeness 45 against 36)
const SLABS2 = typeof location === 'undefined' || !/[?&]slabs2=0/.test(location.search);   // kept in round 21 (closeness 42 against 35)   // round 21: more middle-sized pieces, each tilted with one end in the mulch, two tones along its grain   // round 20: a few hand-sized slabs and long splinters lying on the traced mulch as real thin pieces (the scan's chips are all one size)
const TWK = typeof location !== 'undefined' && /[?&]twk=1/.test(location.search);   // round 20: inside 4.6 m every twig of the scan, 3 mm thicker, so the leaves hang on a visible twig network
const PIT2 = typeof location === 'undefined' || !/[?&]pit2=0/.test(location.search);   // kept in round 19 (closeness 43 against 38)   // round 19: no grey-blue pieces in the mulch, a crisp dark line where bark meets mulch, greyer bark low on the scan trunk
const LIMBS = typeof location === 'undefined' || !/[?&]limbs=0/.test(location.search);   // kept in round 19 (closeness 24/24 against 23/22)   // round 19: lighter limbs in the scan tree's crown
const MPATH = typeof location !== 'undefined' && /[?&]treesfull=1/.test(location.search) && /[?&]mulch=path/.test(location.search);   // round 18: a coarser mulch scan (Poly Haven Wood Chip Path: chunks, twigs, bare soil) laid 1.5 times life size
const HYBRID = typeof location === 'undefined' || !/[?&]crown=(cut|twigs)/.test(location.search);   // default since round 18 (closeness 27 against 22 under the tree, equal beyond); ?crown=cut = the pure round-13 look   // round 18: the twigs inside 4.6 m only, the kept cut-out sprays beyond
const TWIGS = typeof location !== 'undefined' && /[?&]crown=twigs/.test(location.search);   // round 16: the scan's leaves re-set as twigs of single leaves, each leaf real geometry, lit leaf by leaf: not better by the judges yet, so off; ?crown=twigs on
const BOUGHS_DEFAULT = true;   // round 11: whole boughs cut from a scanned tree as the near crown of the pinnate species; ?boughs=1 / ?boughs=0
const BOUGHS = typeof location !== 'undefined' && /[?&]boughs=1/.test(location.search) ? true : typeof location !== 'undefined' && /[?&]boughs=0/.test(location.search) ? false : BOUGHS_DEFAULT;
const SCAN_DEFAULT = true;   // round 12: the hero blocks' broad-leaved trees are a whole scanned young tree (tools/trees_mkscan.py); ?scan=1 / ?scan=0
const SCAN = typeof location !== 'undefined' && /[?&]scan=1/.test(location.search) ? true : typeof location !== 'undefined' && /[?&]scan=0/.test(location.search) ? false : SCAN_DEFAULT;
const VARIANTS = [['plane', 3], ['planeBig', 2], ['locust', 3], ['pear', 2], ['broad', 2], ['ginkgo', 4], ['linden', 1], ['sophora', 1], ['oak', 1]];
// the hero blocks (Flatiron to 26th St, 6th Ave to Madison): street trees are the city's census trees there, not the lead's random ones
const HERO_BOX = [-400, -525, -22, -138];
// leaf colour (linear albedo) per species
const LEAFCOL = { plane: [0.078, 0.106, 0.042], planeBig: [0.068, 0.094, 0.038], locust: [0.118, 0.134, 0.046], pear: [0.040, 0.064, 0.028], broad: [0.058, 0.082, 0.034],
  ginkgo: [0.062, 0.088, 0.026], linden: [0.062, 0.092, 0.034], sophora: [0.070, 0.098, 0.036], oak: [0.058, 0.084, 0.030] };
const YELLOWS = { plane: 0.3, planeBig: 0.28, locust: 0.55, pear: 0.08, broad: 0.3, ginkgo: 0.25, linden: 0.2, sophora: 0.3, oak: 0.2 };

const ZOOMK = { value: 1 };   // 1 / the zoom the bands are chosen by (set in update)
const h2 = (x, y, k = 0) => { const s = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

const COMMON_FRAG = `
  varying vec3 vWPos; uniform sampler2D tLight; uniform vec2 uHalf;
  uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
  ${NOISE_GLSL}
  vec3 bakeV; vec3 bakeN;`;
const BAKE_READ = `bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);`;

function leafMaterial(shared, far, imp, spray) {   // spray: { c, n, mean }: the crown is leaf sprays cut from scanned leaves (cards), not single leaf meshes   // far: the bands beyond the nearest skip the sky reflection (the costly part of the standard material)
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  m.shadowSide = THREE.DoubleSide;
  if (spray) { m.map = spray.c; m.normalMap = spray.n; m.alphaTest = 0.36; m.alphaToCoverage = true; m.defines = { CARD: 1 }; m.roughness = 0.5; }
  if (spray && spray.geo) { m.alphaTest = 0; m.alphaToCoverage = false; m.defines.GEO = 1; }   // every leaf is its own mesh: no cut-out
  if (spray && spray.fringe) { m.alphaTest = 0; m.alphaToCoverage = false; m.transparent = true; m.depthWrite = false; m.forceSinglePass = true; m.defines.FRINGE = 1; }
  if (spray && spray.fade) m.defines.FADE = 1;
  if (spray && spray.vis8) m.defines.VIS8 = 1;
  const LEAF = imp ? 'iLeaf' : 'vLeaf', SUNF = imp ? 'iSunFace' : 'vSunFace';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, imp ? { tImpA: { value: imp.a }, tImpN: { value: imp.n } } : {}, spray ? { uMean: { value: new THREE.Vector3(spray.mean[0], spray.mean[1], spray.mean[2]) }, uTrans: { value: spray.trans || 0.85 }, uGlow: { value: spray.glow || 1.0 }, uSelfK: { value: spray.selfK || 1.6 }, uOwn: { value: spray.own ? 1 : 0 }, uSpec: { value: spray.spec || 1.6 }, uSat: { value: spray.sat || 1.0 }, uShade: { value: spray.shade || 1.0 }, uFwd: { value: spray.fwd || 0.0 }, uThru: { value: new THREE.Vector3(...(spray.thru || [1.0, 1.1, 0.55])) }, uFade: { value: new THREE.Vector4(...(spray.fade || [1e9, 2e9, -2, -1])) }, uZoomK: ZOOMK } : {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aLeaf; varying vec4 vLeaf; varying vec3 vWPos; varying vec3 vTint; varying float vSunFace; uniform vec3 uSunDir; varying float vSelf;
        #ifdef CARD
          uniform float uSelfK;
        #endif
        #if defined(GEO) || defined(VIS8)
          attribute vec4 aVisA; attribute vec4 aVisB;
        #endif
        #ifdef FADE
          attribute float aFd; uniform vec4 uFade; uniform float uZoomK;
        #endif
        bool fdHide = false;
        ${imp ? '' : 'attribute vec3 aCrown;'}
        ${imp ? 'attribute vec3 iPos; attribute vec4 iA; attribute vec2 iB; attribute vec3 iTint; varying vec2 vIuv; varying vec2 vYaw; float iHw;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeaf = aLeaf; vTint = vec3(1.0);
        #ifdef USE_INSTANCING
          mat4 tM = modelMatrix * instanceMatrix;
        #else
          mat4 tM = modelMatrix;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vWPos = (tM * vec4(position, 1.0)).xyz;
        #ifdef FADE
        { // bands hand over piece by piece: each piece has its own distance, inside the overlap, at which it comes or goes
          float fd = length(cameraPosition.xz - tM[3].xz) * uZoomK;
          fdHide = fd > uFade.x + aFd * (uFade.y - uFade.x) || fd < uFade.z + aFd * (uFade.w - uFade.z); }
        #endif
        vSunFace = dot(normalize(mat3(tM) * normal.xyz), uSunDir); vSelf = 1.0;
        ${imp ? '' : `
        #if defined(GEO) || defined(VIS8)
        { // whether the sun reaches this leaf through the crown: baked for eight compass directions in the tree's own frame
          vec3 sl = normalize(transpose(mat3(tM)) * uSunDir); float fa = mod(atan(sl.z, sl.x) / 0.7853982 + 8.0, 8.0); int i0 = int(floor(fa));
          float v8[8] = float[8](aVisA.x, aVisA.y, aVisA.z, aVisA.w, aVisB.x, aVisB.y, aVisB.z, aVisB.w);
          vSelf = mix(v8[i0 % 8], v8[(i0 + 1) % 8], fa - floor(fa)); }
        #else
        {
          // the crown's own shade: how much of the crown (an ellipsoid round the leaves) lies between this leaf and the sun
          vec3 q = aCrown * 1.6, sl = normalize(transpose(mat3(tM)) * uSunDir);
          float b = dot(q, sl), c = dot(q, q) - 1.0, disc = b * b - c, t = disc > 0.0 ? max(-b + sqrt(disc), 0.0) : 0.0;
          #ifdef CARD
            vSelf = exp(-t * uSelfK);
          #else
            vSelf = exp(-t * 1.9);
          #endif
        }
        #endif`}
        ${imp ? `{
          // a quad turned to the camera about the vertical; the view of the crown baked nearest to this direction, in the tree's own frame
          vec2 dw = cameraPosition.xz - iPos.xz; dw /= max(length(dw), 1e-3);
          float k = floor(mod((atan(dw.x, dw.y) - iA.x) / ${(2 * Math.PI / IMP_VIEWS).toFixed(7)} + 0.5, ${IMP_VIEWS}.0)), ak = k * ${(2 * Math.PI / IMP_VIEWS).toFixed(7)};
          iHw = length(vec2(cos(ak) * iA.z, sin(ak) * iA.w));
          transformed = iPos + vec3(dw.y, 0.0, -dw.x) * (position.x * iHw) + vec3(0.0, mix(iB.x, iB.y, position.y), 0.0);
          vIuv = vec2((k + position.x * 0.5 + 0.5) / ${IMP_VIEWS}.0, (iA.y + position.y) / ${imp.rows}.0);
          vYaw = vec2(sin(iA.x), cos(iA.x)); vTint = iTint; vWPos = transformed;
        }` : ''}`);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n if (fdHide) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);');
    if (imp) sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        #ifdef USE_SHADOWMAP
          worldPosition.xyz += uSunDir * iHw * 1.25;     // the crown's own shade comes from its normals; the shadow map is asked just outside the crown, toward the sun
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vLeaf; varying vec3 vTint; varying float vSunFace; float lfFlip; varying float vSelf;
        #ifdef CARD
          uniform vec3 uMean; uniform float uTrans; uniform float uGlow; uniform float uOwn; uniform float uSpec; uniform float uSat; uniform float uShade; uniform float uFwd; uniform vec3 uThru; float cardAo;
        #endif
        ${imp ? 'varying vec2 vIuv; varying vec2 vYaw; uniform sampler2D tImpA; uniform sampler2D tImpN; vec4 iLeaf; vec3 iNrmW; float iSunFace;' : ''}
        ${COMMON_FRAG}`)
      .replace('#include <color_fragment>', `
        {
          ${imp ? `vec4 ta = texture2D(tImpA, vIuv, 0.6); if (ta.a < 0.2) discard; diffuseColor.a = smoothstep(0.2, 0.62, ta.a);
          iLeaf = vec4(ta.rgb / ta.a, 0.55); vec3 tn = texture2D(tImpN, vIuv, 0.6).rgb / ta.a * 2.0 - 1.0;
          iNrmW = normalize(vec3(tn.x * vYaw.y + tn.z * vYaw.x, tn.y, -tn.x * vYaw.x + tn.z * vYaw.y)); iSunFace = dot(iNrmW, uSunDir);` : ''}
          float br = ${LEAF}.r * 1.25, yel = ${LEAF}.g;
          vec3 c = vTint * br;
          #ifdef CARD
            c *= clamp(diffuseColor.rgb / uMean, 0.0, 2.6);   // the scanned leaves' own colour, about the species' green
            c = max(mix(vec3(dot(c, vec3(0.3, 0.6, 0.1))), c, uSat), 0.0);
            #ifdef GEO
              diffuseColor.a = 1.0;
            #else
            { // a spray seen edge-on is a smear of its texture: it thins out and goes instead
              vec3 gN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
              diffuseColor.a *= smoothstep(0.10, 0.34, abs(dot(gN, normalize(vViewPosition)))); }
            #endif
            #ifdef FRINGE
            { // the second, blended drawing: only the pixel and a half outside the hard cut-out edge, fading out
              float fa = diffuseColor.a, fw = max(fwidth(fa), 0.004) * 1.5;
              if (fa >= 0.36) discard;
              diffuseColor.a = clamp((fa - 0.36) / fw + 1.0, 0.0, 1.0); if (diffuseColor.a < 0.03) discard; }
            #endif
          #endif
          c = mix(c, vec3(0.26, 0.20, 0.04) * br, yel * 0.8);
          #ifndef CARD
          c *= mix(0.72, 1.08, ${LEAF}.a);                      // darker along the midrib, paler toward the edge
          #endif
          ${imp ? 'c = mix(vec3(dot(c, vec3(0.3, 0.6, 0.1))), c, 0.82) * 0.86;   // a crown seen whole is duller than its sunlit leaves: inner shade and sky show through' : ''}
          diffuseColor.rgb = c;
          ${BAKE_READ}
        }`)
      .replace('#include <lights_physical_fragment>', `
        {
          normal = ${imp ? 'normalize((viewMatrix * vec4(iNrmW, 0.0)).xyz)' : 'normalize(vNormal)'};                       // the baked shading normal, not flipped for back faces
          #ifdef CARD
          {
            // each leaf of the spray is tilted its own way (the atlas's second map), so the spray is not lit as one flat card
            vec4 sn = texture2D(normalMap, vNormalMapUv); vec2 txy = sn.xy * 2.0 - 1.0; cardAo = sn.b;
            normal = normalize(normal + (tbn[0] * txy.x + tbn[1] * txy.y) * faceDirection * 0.9);
          }
          #endif
          vec3 lfL = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          float lfNdl = dot(normal, lfL); lfFlip = 0.0;
          vec3 lfV = normalize(vViewPosition);
          float lfBack = pow(max(dot(-lfV, lfL), 0.0), 2.0);
          #ifdef GEO
          { // a real leaf: seen from the side the sun strikes it reflects (waxy, a little sheen); seen from the other side the sun comes
            // THROUGH the blade, yellow-green and bright. Shoots and stalks are opaque.
            float ndv = dot(normal, lfV), blade = step(0.5, vLeaf.a);
            if (lfNdl < 0.0) normal = -normal;
            if (blade < 0.5) diffuseColor.rgb = vec3(0.060, 0.047, 0.036) * (0.7 + 0.6 * vLeaf.r);     // twigs and stalks: grey-brown wood, not leaf
            if (lfNdl * ndv < 0.0) { lfFlip = 1.0; roughnessFactor = 1.0; diffuseColor.rgb *= mix(vec3(0.5), uThru * uTrans, blade); }
            normal = normalize(mix(normal, lfL, 0.25 * blade));   // leaves are thin and scatter: the falloff toward grazing sun is gentle
            diffuseColor.rgb *= 1.0 + lfBack * vec3(0.15, 0.17, 0.03) * uGlow;
          }
          #else
          if (lfNdl < 0.0) {
            // lit from behind: the leaf passes the light on, yellower and a little brighter; the shadow map still decides whether sun reaches it
            normal = normalize(mix(normal - 2.0 * lfNdl * lfL, lfL, 0.35)); lfFlip = 1.0;
            #ifdef CARD
            diffuseColor.rgb *= uThru * mix(0.7, 1.0, ${LEAF}.b) * uTrans; roughnessFactor = 1.0;   // sun through a leaf: yellow-green, nearly as bright as the lit face
            #else
            diffuseColor.rgb *= vec3(1.0, 1.08, 0.6) * mix(0.65, 1.0, ${LEAF}.b) * 0.55; roughnessFactor = 1.0;
            #endif   // a leaf passes on about half what it would reflect
          } else {
            // sunlit leaves on the far side of the crown, seen from behind through the gaps: the same transmitted colour
            float seeBack = smoothstep(0.0, -0.35, dot(normal, lfV));
            diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 1.08, 0.6), seeBack);
          }
          #ifdef CARD
          diffuseColor.rgb *= 1.0 + lfBack * vec3(0.15, 0.17, 0.03) * uGlow;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.3, 1.75, 0.4), lfBack * uFwd);   // looking toward the sun through the crown: the light that comes through a leaf is a saturated yellow-green
          #else
          diffuseColor.rgb *= 1.0 + lfBack * vec3(0.15, 0.17, 0.03);
          #endif
          #endif
        }
        #include <lights_physical_fragment>`)
      .replace('#include <lights_fragment_maps>', far ? `
        #if defined( USE_ENVMAP ) && defined( RE_IndirectDiffuse ) && defined( ENVMAP_TYPE_CUBE_UV )
          iblIrradiance += getIBLIrradiance( geometryNormal );
        #endif` : '#include <lights_fragment_maps>')
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float lAo = ${LEAF}.b;
          #ifdef CARD
            lAo *= mix(0.4, 1.0, cardAo);
          #endif
          #ifdef CARD
            #ifdef GEO
              reflectedLight.indirectDiffuse *= mix(${DEEP ? '0.35' : '0.75'}, 1.25, lAo) * ${DEEP ? '1.2' : '1.5'};   // sky light comes through and round the leaves of an open crown
            #else
              reflectedLight.indirectDiffuse *= ${FARFIX ? (far || imp ? 'mix(0.60, 1.0, lAo)' : 'mix(mix(0.16, 0.42, 1.0 - bakeV.g), 0.95, lAo)') : 'mix(0.16, 0.95, lAo)'};
            #endif
          #else
            reflectedLight.indirectDiffuse *= ${FARFIX ? (far || imp ? 'mix(0.60, 1.0, lAo)' : 'mix(mix(0.10, 0.42, 1.0 - bakeV.g), 0.9, lAo)') : 'mix(0.10, 0.9, lAo)'};
          #endif
          ${FARFIX ? 'reflectedLight.indirectDiffuse += material.diffuseColor * uSunColor * ' + (far || imp ? '0.05' : '0.03 * (1.0 - bakeV.g)') + ';   // open shade in a street is never black: light off the facades opposite' : ''}
          reflectedLight.indirectSpecular *= lAo * lAo * 0.3;   // leaves are matte enough that the sky must not frost the top of the crown
          float tFar = ${imp ? '1.0' : 'smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz))'};
          float selfVis = clamp(0.22 + 0.95 * ${SUNF}, 0.04, 1.0) * mix(0.25, 1.0, lAo)${imp ? ' * 0.78' : ''};
          #ifdef GEO
            float sv = ${DEEP ? '0.06 + 0.94' : '0.22 + 0.78'} * smoothstep(${DEEP ? '0.30, 0.58' : '0.22, 0.50'}, vSelf + (fract(vLeaf.r * 91.7 + vLeaf.b * 13.1) - 0.5) * 0.16);   // in the sun or in the shade of the leaves above; an open crown is full of scattered light, so its shade is never dark
          #else
            #ifdef VIS8
            float sv = 0.10 + 0.90 * smoothstep(0.22, 0.50, vSelf + (fract(vLeaf.r * 91.7 + vLeaf.b * 13.1) - 0.5) * 0.16);   // the sun reaches this piece through the crown, or it does not
            #else
            float sv = max(vSelf, 0.6 * step(0.86, fract(vLeaf.r * 91.7 + vLeaf.b * 13.1 + vLeaf.a * 5.3)));
            #endif
            //   // a few leaves deep inside catch a fleck of sun through a gap
          #endif
          #ifdef GEO
            float k = mix(mix(0.7, 1.0, lAo) * sv, selfVis, tFar);
          #else
            float k = mix(mix(0.3, 1.0, lAo) * sv, selfVis, tFar);
          #endif
          reflectedLight.directDiffuse *= k; reflectedLight.directSpecular *= k * (1.0 - lfFlip) * ${imp ? '0.5' : '1.0'};
          #ifdef CARD
            reflectedLight.directSpecular *= uSpec;   // the waxy upper face of a leaf glints in the sun
            ${SPECFADE ? 'reflectedLight.directSpecular = min(reflectedLight.directSpecular * mix(0.12, 1.0, smoothstep(26.0, 7.0, length(vViewPosition))), vec3(0.6) * dot(reflectedLight.directDiffuse, vec3(0.333)) + 0.02);' : ''}
            // a crown that takes no shadow from the shadow map (its own shade is worked out leaf by leaf above): buildings' shade comes from the ground bake
            { float bk = mix(1.0, mix(bakeV.g, 1.0, tFar), uOwn);
              // leaf by leaf, some stand in the shade of their neighbours and some in a shaft of sun: fewer shaded on the outside of the crown
              float lh = fract(vLeaf.r * 57.3 + vLeaf.g * 7.1); bk *= mix(1.0, mix(1.0, uShade, step(lh, 0.5 * (1.0 - 0.6 * lAo))), uOwn);
              reflectedLight.directDiffuse *= bk; reflectedLight.directSpecular *= bk; }
          #endif
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeLeaf23' + (FARFIX ? 'z' : '') + (DEEP ? 'd' : '') + (far ? 'f' : '') + (imp ? 'i' : '') + (spray ? 'c' : '') + (spray && spray.geo ? 'g' : '') + (spray && spray.fringe ? 'F' : '') + (spray && spray.fade ? 'D' : '') + (spray && spray.vis8 ? 'V' : '') + (SPECFADE ? 'S' : '');
  return m;
}

function woodMaterial(shared, map, normalMap, kind, tSoil, scan, detail, bark2) {   // detail: [albedo, normal] of a fine tiling bark cut into a scanned trunk (round 16, with ?crown=twigs)
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, map, normalMap });
  { const ns = kind === 0 ? 1.5 : kind === 3 ? 2.1 : kind === 4 ? 1.4 : kind === 5 ? (bark2 ? (PLANE ? 0.45 : 0.7) : 1.5) : 2.4; m.normalScale.set(ns * (bark2 && kind < 4 ? 0.45 : 1), ns * (bark2 && kind < 4 ? 0.45 : 1)); }
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tSoil: { value: tSoil }, uProj: PROJ }, scan ? { tScanN: { value: scan.normal } } : {}, detail ? { tBarkD: { value: detail[0] }, tBarkDN: { value: detail[1] } } : {}, bark2 ? { tB2: { value: bark2[0] }, tB2N: { value: bark2[1] }, tB2D: { value: bark2[2] } } : {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${bark2 ? 'varying vec3 vBP; varying vec3 vBN;' : ''}
        attribute vec4 aW; varying vec4 vW; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vLocN; ${scan ? 'attribute vec2 aUv2; varying vec2 vUv2;' : ''} ${detail ? 'varying mat3 vNM;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${kind === 5 && FLARE ? '{ float fy = max(position.y, 0.0), fr = length(position.xz), fa = atan(position.z, position.x); if (fy < 0.6 && fr < 0.35) { float fl = (0.42 * exp(-fy / 0.07) + 0.10 * exp(-fy / 0.25)) * (0.55 + 0.45 * sin(fa * 3.0 + 1.3) + 0.2 * sin(fa * 7.0)); transformed.xz *= 1.0 + max(fl, 0.0); } }' : ''}
        vW = aW; vLoc = position; vLocN = normal; ${scan ? 'vUv2 = aUv2;' : ''}
        #ifdef USE_INSTANCING
          ${detail ? 'vNM = mat3(viewMatrix * modelMatrix * instanceMatrix);' : ''}
          vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          ${bark2 ? 'vBP = vWPos - (modelMatrix * instanceMatrix)[3].xyz; vBN = mat3(modelMatrix * instanceMatrix) * normal;' : ''}
        #else
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
          ${bark2 ? 'vBP = vWPos - modelMatrix[3].xyz; vBN = mat3(modelMatrix) * normal;' : ''}
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vW; varying vec3 vLoc; varying vec3 vLocN; uniform sampler2D tSoil; float wShed; ${bark2 ? 'varying vec3 vBP; varying vec3 vBN; uniform sampler2D tB2; uniform sampler2D tB2N; uniform sampler2D tB2D; vec3 b2n = vec3(0.0); float b2k = 0.0; float b2ao = 1.0;' : ''} ${scan ? 'varying vec2 vUv2; uniform sampler2D tScanN;' : ''} ${detail ? 'uniform sampler2D tBarkD; uniform sampler2D tBarkDN; varying mat3 vNM; vec3 barkDn;' : ''}
        ${COMMON_FRAG}
        ${SLAB_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0), wShed * 0.92));   // bare wood under a shed plate has no furrows
        ${detail ? 'normal = normalize(normal + normalize(vNM * barkDn + 1e-5) * length(barkDn) * 1.1);' : ''}
        ${bark2 ? 'normal = normalize(normal + mat3(viewMatrix) * b2n * 1.1 * b2k);' : ''}
        ${scan ? `{
          // the scanned foot: the species' own bark colour and fine relief at full sharpness, the scan's normal map for the big forms only
          vec3 gN = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          mat3 tbn2 = getTangentFrame(-vViewPosition, gN, vUv2);
          vec3 sN = normalize(tbn2 * (texture2D(tScanN, vUv2).xyz * 2.0 - 1.0));
          normal = normalize(normal + (sN - gN) * 0.75 * vW.b);   // the species' fine bark relief stays; the scan adds its creases and swellings
        }` : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // the foot goes a little way down into the soil of its pit, to an uneven line
          if (vWPos.y < 0.150 - 0.05) discard;
          slabDepth(vWPos);
          ${BAKE_READ}
          vec3 c = diffuseColor.rgb; float lum = dot(c, vec3(0.333)); wShed = 0.0;
          vec3 an = abs(normalize(vLocN)); float wx = an.x / (an.x + an.z + 1e-4);
          ${kind === 0 ? `
            // London plane: grey-brown outer bark flaking off in jigsaw plates to olive, then cream; more bare bark up the limbs
            c = mix(vec3(lum), c, 0.35) * vec3(0.50, 0.46, 0.38);
            float n1 = mix(fbm(vLoc.xy * vec2(6.5, 3.4) + 3.0), fbm(vLoc.zy * vec2(6.5, 3.4) + 11.0), wx);
            float n2 = mix(fbm(vLoc.xy * vec2(19.0, 11.0) + 23.0), fbm(vLoc.zy * vec2(19.0, 11.0) + 31.0), wx);
            float n3 = mix(fbm(vLoc.xy * vec2(47.0, 29.0) + 5.0), fbm(vLoc.zy * vec2(47.0, 29.0) + 9.0), wx);
            float n = n1 * 0.62 + n2 * 0.26 + n3 * 0.12, thr = mix(0.38, 0.46, vW.g * smoothstep(7.0, 1.5, vLoc.y)) + 0.12 * smoothstep(2.6, 0.2, vLoc.y);
            vec3 olive = vec3(0.20, 0.20, 0.13) * (0.7 + 0.3 * n2 + 0.6 * lum), cream = vec3(0.27, 0.26, 0.205) * (0.7 + 0.3 * n2 + 0.6 * lum);
            wShed = smoothstep(thr - 0.003, thr + 0.003, n);
            c = mix(c, olive, wShed);
            c = mix(c, cream, smoothstep(-0.003, 0.003, n - thr - 0.012 - 0.05 * n2));
            c *= 1.0 - 0.3 * smoothstep(thr - 0.008, thr - 0.002, n) * (1.0 - wShed);   // the step down from the old bark, in shade; a lesser one to the newest layer
          ` : kind === 5 && detail ? `
            // a whole scanned tree: its own bark as photographed, greyed toward a city street tree's, with the fine fissures of a
            // photographed bark (1 m to the tile, laid from three sides) cut into it: the scan's 2K atlas is soft at arm's length
            c = mix(vec3(lum), c, 0.5) * vec3(1.12, 1.08, 1.04);
            { vec3 bw = pow(abs(normalize(vLocN)), vec3(4.0)); bw /= bw.x + bw.y + bw.z; vec3 q = vLoc * 1.15;
              vec3 dX = texture2D(tBarkD, q.zy).rgb, dY = texture2D(tBarkD, q.xz).rgb, dZ = texture2D(tBarkD, q.xy).rgb; float dl = dot(dX * bw.x + dY * bw.y + dZ * bw.z, vec3(0.333));
              c *= clamp(0.35 + dl / 0.21, 0.3, 1.6);
              vec2 nX = texture2D(tBarkDN, q.zy).xy * 2.0 - 1.0, nY = texture2D(tBarkDN, q.xz).xy * 2.0 - 1.0, nZ = texture2D(tBarkDN, q.xy).xy * 2.0 - 1.0;
              barkDn = bw.x * vec3(0.0, nX.y, nX.x) + bw.y * vec3(nY.x, 0.0, nY.y) + bw.z * vec3(nZ.x, nZ.y, 0.0); }
          ` : kind === 5 ? `
            // a whole scanned tree: its own bark as photographed
            c = mix(vec3(lum), c, ${PIT2 ? 'mix(0.6, 0.9, smoothstep(0.5, 1.2, vLoc.y)) * smoothstep(0.03, 0.09, vLoc.y)' : '0.9'}) * vec3(0.84, 0.82, 0.79)${PIT2 ? ' * 1.12' : ''};
            ${PIT2 ? 'c *= mix(' + (BASE2 ? '0.8' : '0.6') + ', 1.0, smoothstep(0.0, 0.05, vWPos.y - 0.15 - 0.05));   // the dark line where the trunk goes into the mulch' : ''}
            ${bark2 ? `{ // photographed bark at the tree's real size: laid from the two sides and from above in world metres, 1.3 m to the tile
              b2k = step(vMapUv.x, 0.5) * ${BARKALL || PLANE ? '1.0' : '(1.0 - smoothstep(1.15, 1.9, vLoc.y))'};   // the trunk only: limbs are young, smooth bark (the scan's own)   // the trunk and limbs (the twigs keep their own picture)
              vec3 bn = normalize(vBN), bw = pow(abs(bn), vec3(6.0)); bw.y *= 0.4; bw /= bw.x + bw.y + bw.z; vec3 q = vBP / ${PLANE ? 'vec3(' + PT + ', 2.0 * ' + PT + ', ' + PT + ')' : '1.3'};
              vec3 bc = texture2D(tB2, q.zy).rgb * bw.x + texture2D(tB2, q.xz).rgb * bw.y + texture2D(tB2, q.xy).rgb * bw.z;
              vec2 da = texture2D(tB2D, q.zy).rg * bw.x + texture2D(tB2D, q.xz).rg * bw.y + texture2D(tB2D, q.xy).rg * bw.z; b2ao = mix(1.0, da.g, b2k);
              vec2 nX = texture2D(tB2N, q.zy).xy * 2.0 - 1.0, nY = texture2D(tB2N, q.xz).xy * 2.0 - 1.0, nZ = texture2D(tB2N, q.xy).xy * 2.0 - 1.0;
              b2n = bw.x * vec3(0.0, nX.y, nX.x) + bw.y * vec3(nY.x, 0.0, nY.y) + bw.z * vec3(nZ.x, nZ.y, 0.0);
              float bl = dot(bc, vec3(0.333)); vec3 lowc = texture2D(map, vMapUv, 5.0).rgb; float big = clamp(dot(lowc, vec3(0.333)) / 0.11, 0.75, 1.25);   // the scan's own light and dark patches stay, at large scale only
              vec3 c2 = mix(vec3(bl), bc, 0.62) * vec3(1.0, 0.97, 0.95) * big * ${BK} * mix(0.62, 1.0, smoothstep(0.30, 0.82, da.g));                               // a city tree: greyer, sooty in the furrows
              ${PLANE ? 'c2 = bc * ' + PK + ' * mix(0.85, 1.12, clamp(big - 0.75, 0.0, 0.5) * 2.0) * mix(0.5, 1.0, da.g);' : ''}
              c = mix(c, c2, b2k); }` : ''}
          ` : kind === 4 ? `
            // a scanned limb with its own photographed bark: as it is, a little greyed
            c = mix(vec3(lum), c, 0.75) * vec3(0.78, 0.74, 0.70);
          ` : kind === 3 ? `
            // photographed bark (Poly Haven), at its own scale: keep its colour, a little greyed by the city's grime
            c = mix(vec3(lum), c, 0.55) * vec3(1.42, 1.36, 1.30) * mix(0.25, 1.0, vW.g * vW.g);   // young limbs and twigs are darker and smoother than the trunk
          ` : kind === 1 ? `
            // honey locust: dark grey-brown, furrowed
            c = mix(vec3(lum), c, 0.30) * vec3(0.50, 0.45, 0.40) * (0.7 + 0.6 * fbm(vLoc.xy * 2.0 + vLoc.zy));
          ` : `
            // callery pear, elm, oak: grey-brown with lighter ridges
            c = mix(vec3(lum), c, 0.25) * vec3(0.42, 0.385, 0.34) * (0.7 + 0.6 * fbm(vLoc.xy * 2.3 + vLoc.zy * 1.3));
          `}
          ${bark2 && kind < 4 ? `{ // a generated trunk: the photographed bark at real size (1.1 m to the tile, from the two sides and from above); the species keeps its own tone
            b2k = smoothstep(0.22, 0.70, vW.g) * (1.0 - 0.5 * wShed);
            vec3 bn = normalize(vBN), bw = pow(abs(bn), vec3(6.0)); bw.y *= 0.4; bw /= bw.x + bw.y + bw.z; vec3 q = vBP / ${TRKT};
            vec3 bc = texture2D(tB2, q.zy).rgb * bw.x + texture2D(tB2, q.xz).rgb * bw.y + texture2D(tB2, q.xy).rgb * bw.z;
            vec2 da = texture2D(tB2D, q.zy).rg * bw.x + texture2D(tB2D, q.xz).rg * bw.y + texture2D(tB2D, q.xy).rg * bw.z; b2ao = mix(1.0, da.g, b2k);
            vec2 nX = texture2D(tB2N, q.zy).xy * 2.0 - 1.0, nY = texture2D(tB2N, q.xz).xy * 2.0 - 1.0, nZ = texture2D(tB2N, q.xy).xy * 2.0 - 1.0;
            b2n = (bw.x * vec3(0.0, nX.y, nX.x) + bw.y * vec3(nY.x, 0.0, nY.y) + bw.z * vec3(nZ.x, nZ.y, 0.0)) * ${TRKN};
            float bl = dot(bc, vec3(0.333)); vec3 ratio = clamp(mix(vec3(bl / 0.098), bc / vec3(0.117, 0.098, 0.080), 0.5), 0.3, 2.0);
            c = mix(c, c * ratio * mix(0.30, 1.0, smoothstep(0.30, 0.82, da.g)) * ${TRKK}, b2k); }` : ''}
          // green-grey algae stain low on the shaded side, dirt at the foot
          // furrows are shaded, ridges catch the light; grey and green-grey patches; damp and dirt low down, lapping up unevenly
          ${kind >= 3 ? '' : bark2 ? 'c *= mix(mix(0.66 + 0.55 * clamp((lum - 0.2) / 0.28, 0.0, 1.0), 1.0, wShed), 0.92, 0.85 * b2k);   // the tiled bark under it runs in stretched streaks: the photographed bark carries the furrows' : 'c *= mix(0.66 + 0.55 * clamp((lum - 0.2) / 0.28, 0.0, 1.0), 1.0, wShed);'}
          float pn = fbm(vLoc.xy * 1.4 + vLoc.zy * 0.9 + 5.0);
          c *= mix(vec3(1.0), vec3(0.86, 0.94, 0.80), smoothstep(0.5, 0.7, pn) * smoothstep(3.0, 0.2, vLoc.y) * 0.6);
          c *= mix(vec3(1.0), vec3(1.12, 1.1, 1.08), smoothstep(0.5, 0.3, pn) * 0.7);
          // the lowest bark is the dirtiest: splash, soot and damp staining that climbs unevenly, soil caked on the foot
          float dn = fbm(vLoc.xz * 4.0 + vLoc.y * 2.0), dn2 = fbm(vLoc.xz * 19.0 + vLoc.y * 13.0);
          float stain = 1.0 - smoothstep(0.02, 0.5, vLoc.y + (dn - 0.5) * 0.45);
          c *= mix(1.0, 0.66 + 0.25 * dn2, stain) * mix(0.88, 1.0, smoothstep(0.3, 1.2, vLoc.y));
          vec3 so = texture2D(tSoil, vWPos.xz / 0.6 + vWPos.y * 1.3).rgb; float sol = dot(so, vec3(0.333));
          float crumb = clamp((0.035 - vLoc.y + (dn - 0.5) * 0.3 + (sol - 0.2) * 0.7 + (dn2 - 0.5) * 0.12) / 0.03, 0.0, 1.0);
          ${kind === 5 ? `{ // mulch rides up the foot of the trunk to an uneven line, its chips caught in the bark
            vec3 mc = texture2D(tSoil, (vWPos.xz + vWPos.y * 0.7) / 3.2).rgb; float ml = dot(mc, vec3(0.333));
            crumb = clamp((${PIT2 ? '0.060' : '0.055'} - (vWPos.y - 0.15) + (dn - 0.5) * ${PIT2 ? '0.08' : '0.12'} + (ml - 0.25) * ${PIT2 ? '0.20' : '0.30'}) / ${PIT2 ? '0.007' : '0.018'}, 0.0, 1.0); so = ${WC3 ? 'mc * 0.7' : PIT2 ? 'mix(vec3(ml), mc, 0.42) * vec3(3.0, 2.95, 2.6) * 0.8' : 'mc * vec3(2.4, 2.3, 2.0)'} / 0.45 * (0.55 + 0.6 * dn2); }` : ''}
          ${SEAT && kind === 5 ? 'crumb = 0.0; c *= mix(0.42, 1.0, smoothstep(-0.01, 0.11, vWPos.y - 0.15 + (dn - 0.5) * 0.07));' : ''}
          c = mix(c, so * 0.45, crumb); wShed *= 1.0 - crumb;
          c *= mix(1.25, 1.0, vW.g);
          ${kind === 5 && (WOODK !== '1.000' || WOODG !== '1.000') ? 'c = pow(max(c, vec3(1e-4)) / 0.1, vec3(' + WOODG + ')) * 0.1 * ' + WOODK + ';' : ''}
          diffuseColor.rgb = c;
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float wAo = vW.r;
          ${bark2 ? 'wAo *= mix(0.7, 1.0, b2ao);' : ''}
          ${bark2 && PLANE ? 'reflectedLight.directDiffuse *= mix(0.45, 1.0, b2ao) * mix(0.55, 1.0, smoothstep(0.25, 0.8, vW.r)); reflectedLight.indirectDiffuse *= mix(0.45, 1.0, smoothstep(0.2, 0.85, vW.r));   // shade in the lee of each plate edge; deeper contact shade in the forks and at the limb joints (the scan-baked occlusion)' : ''}
          reflectedLight.indirectDiffuse *= mix(0.55, 1.0, wAo); reflectedLight.indirectSpecular *= wAo * 0.15;
          ${kind === 5 ? (detail ? 'reflectedLight.indirectDiffuse *= 2.2 + 0.9 * smoothstep(1.5, 3.0, vLoc.y); reflectedLight.directDiffuse *= 1.0 + 0.35 * smoothstep(1.5, 3.0, vLoc.y);' : bark2 ? 'reflectedLight.indirectDiffuse *= 1.5 + 0.9 * smoothstep(1.1, 2.4, vLoc.y); reflectedLight.directDiffuse *= 1.0 + 0.15 * smoothstep(1.1, 2.4, vLoc.y);' : LIMBS ? 'reflectedLight.indirectDiffuse *= 1.7 + 2.0 * smoothstep(1.1, 2.4, vLoc.y); reflectedLight.directDiffuse *= 1.0 + 0.5 * smoothstep(1.1, 2.4, vLoc.y);   // round 19: limbs up in the crown are young, paler bark standing in sky light and the light the leaves pass on' : 'reflectedLight.indirectDiffuse *= 1.7;') : ''}
          ${kind >= 3 ? 'reflectedLight.indirectDiffuse *= 1.0 + 1.5 * exp(-max(vWPos.y - 0.15, 0.0) / 1.1);   // the sunlit paving throws its light back up the trunk' : ''}
          ${kind === 5 && WOODI !== '1.000' ? 'reflectedLight.indirectDiffuse *= ' + WOODI + ';' : ''}
          float tFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz));
          reflectedLight.directDiffuse *= mix(1.0, mix(0.25, 1.0, wAo), tFar);
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeWood29_' + kind + (scan ? 's' : '') + (detail ? 'd' : '') + (LIMBS ? 'l' : '') + (PIT2 ? '4' : '') + (BASE2 ? 'b' : '') + (FLARE ? 'f' : '') + (WC3 ? 'w' : '') + (bark2 ? 'B' : '') + (bark2 && kind < 4 ? 'G2' + TRKN + TRKK + TRKT : '') + BK + (SEAT ? 's' : '') + (BARKALL ? 'a' : '') + WOODK + WOODG + WOODI + (PLANE ? 'P' + PK + PT : '');
  return m;
}

// A hero pit's soil is an image traced into a quad at paving level (sunkPitMaterial). What really stands below the paving there
// (the trunk's foot, loose chips) cannot pass the paving in the depth buffer, so its depth is drawn into a thin slab just in front
// of the paving plane, nearest first.
const PROJ = { value: new THREE.Matrix4() };
const SLAB_GLSL = `
  uniform mat4 uProj;
  void slabDepth(vec3 wpos) {
    float py = 0.154; gl_FragDepth = gl_FragCoord.z;
    if (wpos.y < py) { vec3 rd = wpos - cameraPosition; float tP = (py - cameraPosition.y) / min(rd.y, -1e-4);
      if (tP > 0.0 && tP < 1.0) { float len = length(rd), mg = 0.004 + 0.005 * len * tP * length(rd.xz) / max(-rd.y, 1e-3);   // the pit's quad is drawn with a slope-scaled offset: stay in front of that too
        vec3 wp = cameraPosition + rd / len * (len * tP - mg * (1.0 - 0.6 * clamp(len * (1.0 - tP) / 0.4, 0.0, 1.0)));
        vec4 cp = uProj * viewMatrix * vec4(wp, 1.0); gl_FragDepth = clamp(cp.z / cp.w * 0.5 + 0.5, 0.0, 1.0); } }
  }`;
// the hero pits' mulch: the scanned wood chips laid 1.6 times life size (street-tree mulch is coarse shredded wood), dry and pale on
// top, dark in the gaps; one function for the traced soil and for the mulch heaped against the trunk, so the two join without a seam
const MULCH_GLSL = `
  uniform sampler2D tChips; uniform sampler2D tChipsN; uniform sampler2D tDisp;
  const float MS = ${PHOTO ? MSV : MPATH ? '2.2' : WC3 ? '1.6' : '2.4'};
  vec2 muv(vec2 q, float seed) { ${SUNM ? 'vec2 s = normalize(vSunL.xz + vec2(1e-5, 0.0)); const vec2 L0 = vec2(0.6, 0.8); vec2 r = vec2(L0.x * s.x + L0.y * s.y, L0.y * s.x - L0.x * s.y); q = vec2(q.x * r.x - q.y * r.y, q.x * r.y + q.y * r.x);' : ''} return (q + seed * 7.0) / MS; }
  vec3 mulchCol(vec2 uvc, float lod, vec2 q, float seed, float dr) {
    ${PHOTO ? `if (true) { vec3 cc = textureLod(tChips, uvc, lod).rgb * ${MG} * (0.88 + 0.24 * fbm(q * 1.7 + seed * 5.0));
      cc = mix(cc, cc * vec3(0.66, 0.62, 0.58), smoothstep(0.52, 0.74, fbm(q * 2.3 + seed * 3.0)) * ${SUNM ? '0.25' : '0.6'});        // damp patches
      return cc * (0.38 + 0.62 * smoothstep(0.0, 0.04, dr)); }` : ''}
    ${WC3 ? `if (true) { vec3 ch = textureLod(tChips, uvc, lod).rgb; float occ = textureLod(tDisp, uvc, lod).g;
      vec3 cc = mix(vec3(dot(ch, vec3(0.333))), ch, 0.58) * vec3(0.80, 0.77, 0.76) * (0.74 + 0.36 * fbm(q * 1.7 + seed * 5.0));                                                   // the scan's own colour, lighter and darker in patches
      cc = mix(cc, cc * vec3(0.58, 0.53, 0.49), smoothstep(0.52, 0.74, fbm(q * 2.3 + seed * 3.0)) * 0.65);        // damp patches
      cc *= ${CRISP ? 'mix(0.07, 1.08, smoothstep(0.38, 0.80, occ))' : 'mix(0.30, 1.0, smoothstep(0.30, 0.92, occ))'};
      ${PIT3 ? `{ float hb = textureLod(tDisp, uvc, lod).b, pcs = vnoise(q * 43.0 + seed * 9.0), soilP = smoothstep(0.50, 0.70, fbm(q * 3.1 + seed * 7.0));
        cc = mix(cc, cc * vec3(0.42, 0.36, 0.31), smoothstep(0.60, 0.70, pcs));                                    // dark, rotted pieces among the fresh ones
        cc = mix(cc, vec3(0.055, 0.045, 0.036) * (0.7 + 0.6 * vnoise(q * 210.0)), soilP * (1.0 - smoothstep(0.36, 0.50, hb)) * 0.85);   // soil and fines show between the chips in patches
        cc *= 0.55 + 0.45 * smoothstep(0.0, 0.11, dr); }` : ''}
      ${PITALL ? `{ float soilQ = smoothstep(0.34, 0.58, fbm(q * 2.6 + seed * 7.0)), hq = textureLod(tDisp, uvc, lod).b;
        cc = mix(vec3(dot(cc, vec3(0.333))), cc, 0.7) * vec3(${PDK[0]}, ${PDK[1]}, ${PDK[2]}) * mix(1.0, 0.62, smoothstep(0.55, 0.68, vnoise(q * 41.0 + seed * 9.0)));                // a season old: weathered dark brown, some pieces rotted nearly black
        cc = mix(cc, vec3(0.050, 0.041, 0.033) * (0.7 + 0.6 * vnoise(q * 190.0)), soilQ * (1.0 - smoothstep(0.42, 0.62, hq)) * 0.9); }` : ''}   // trodden dark soil shows between the pieces in patches                                                           // the gaps between the pieces are dark
      return cc * (0.38 + 0.62 * smoothstep(0.0, 0.04, dr)); }` : ''}
    vec3 chips = textureLod(tChips, uvc, lod).rgb; float cl = dot(chips, vec3(0.333)), chH = textureLod(tDisp, uvc, lod).r;
    vec3 c = mix(vec3(cl), chips, 0.42) * vec3(3.0, 2.95, 2.6) * (0.2 + 1.2 * smoothstep(0.2, 0.8, chH)) * (0.8 + 0.4 * fbm(q * 1.7 + seed * 5.0)) * (0.6 + 0.4 * smoothstep(0.0, 0.14, dr));
    // bigger pieces lie on top (the same scan laid 2.7 times larger, its tallest chips only), each with the shade under its edge; fines and bare soil show in patches
    float soil = smoothstep(0.52, 0.72, fbm(q * 2.1 + seed * 3.0)) * 0.75;
    float pc = vnoise(q * 37.0 + seed * 9.0), pc2 = vnoise(q * 53.0 + 17.0);
    c = mix(c, vec3(dot(c, vec3(0.333))) * vec3(1.0, 0.97, 0.92) * 0.9, smoothstep(0.66, 0.78, pc) * ${PIT2 ? '0.0' : '0.5'});     // weathered grey-brown pieces (read as grey-blue noise under the sky's light: out with ?pit2=1)
    c *= mix(1.0, 0.55, smoothstep(0.64, 0.74, pc2));                                                              // dark, damp ones
    c = mix(c, c * vec3(0.40, 0.36, 0.33), soil * (1.0 - smoothstep(0.5, 0.85, chH)));
    return c * (0.38 + 0.62 * smoothstep(0.0, 0.04, dr))${MDARK ? ' * vec3(0.74, 0.66, 0.60)' : ''};
  }`;
// sun shadows too fine for the shadow map, worked out per pixel in the pit's own frame: the trunk (a post of radius p2.x at z = p2.y)
// and the guard's bars and rails (half-length p2.z along x; 0 = no guard). loc = point in the pit's frame, sunL = sun direction there.
const PIT_SHADOW_GLSL = `
  float guardSide(float pc, float kc, float pt, float kt, float cl, float lim, float py) {
    if (abs(kc) < 0.02) return 0.0;
    float h = (cl - pc) / kc; if (h < py || h > 0.53) return 0.0;
    float qt = pt + kt * h; if (abs(qt) > lim) return 0.0;
    // the sun's disc gives a penumbra of about a hundredth of the distance to the bar: hard at the foot, a few millimetres at the top rail
    float pen = 0.002 + 0.016 * max(h - py, 0.0);
    float bar = 1.0 - smoothstep(0.006, 0.006 + pen, abs(fract(qt / 0.135) - 0.5) * 0.135);
    float rail = (1.0 - smoothstep(0.011, 0.011 + pen, abs(h - 0.505) * 1.0)) + (1.0 - smoothstep(0.009, 0.009 + pen, abs(h - 0.12)));
    return clamp(bar + rail, 0.0, 1.0);
  }
  float pitShadow(vec3 loc, vec3 sunL, vec3 p2) {
    vec2 hs = sunL.xz; float hl = length(hs), sh = 0.0;
    if (hl > 0.05 && sunL.y > 0.08) {
      vec2 sd = -hs / hl, rel = loc.xz - vec2(0.0, p2.y);
      float al = dot(rel, sd), ac = abs(dot(rel, vec2(-sd.y, sd.x))), R = p2.x * 1.15;
      sh = step(0.01, R) * smoothstep(-0.01, 0.02, al) * (1.0 - smoothstep(R, R + ${PIT3 || SEAT ? '0.003 + 0.012' : '0.01 + 0.03'} * al, ac));
      if (p2.z > 0.01) {
        vec2 k = hs / sunL.y; float hx = p2.z, hz = 0.665, g = 0.0;
        g = max(g, guardSide(loc.z, k.y, loc.x, k.x, -hz, hx, loc.y));
        g = max(g, guardSide(loc.x, k.x, loc.z, k.y, -hx, hz, loc.y));
        g = max(g, guardSide(loc.x, k.x, loc.z, k.y, hx, hz, loc.y));
        sh = max(sh, g * 0.92);
      }
    }
    return sh;
  }`;
// hero: the hero blocks' pits are photographed ground (Poly Haven 'Wood Chips' mulch and 'Park Dirt', at their scanned scale), on a
// 2.5 cm grid lifted by the mulch scan's own height map, so the chips stand up and shade each other at a low view
function pitMaterial(shared, tSoil, tSoilN, hero) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2;
  if (hero) m.defines = { HERO: 1 };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tSoil: { value: tSoil }, tSoilN: { value: tSoilN } }, hero ? { tChips: { value: hero.chips }, tChipsN: { value: hero.chipsN }, tDisp: { value: hero.disp }, tDirt: { value: hero.dirt }, tDirtN: { value: hero.dirtN } } : {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        #ifdef HERO
          uniform sampler2D tDisp;
        #endif
        varying vec3 vWPos; attribute vec4 aPit; attribute float aLift; attribute float aDry; varying vec3 vPit; varying vec3 vPit2; varying float vDry; varying vec3 vLoc; varying vec3 vSunL; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // soil heaped against this tree's trunk (aPit: trunk radius at the soil line, its offset across the pit, a seed, guard half-length), to an uneven line
          vec2 pl = position.xz - vec2(0.0, aPit.y); float rr = length(pl), ang = atan(pl.y, pl.x);
          float irr = 0.5 + 0.22 * sin(ang * 2.0 + aPit.z * 6.283) + 0.14 * sin(ang * 5.0 + aPit.z * 17.0);
          // aPit.x is the trunk's SMALLEST radius at the soil line: the soil is highest there and only falls away outward, so it
          // passes above the trunk mesh all the way round (no gap, no shelf), a crowned mound banked against the bark
          float d = max(rr - aPit.x, 0.0), on = step(0.01, aPit.x) * clamp(aLift, 0.0, 1.0);
          transformed.y += on * ((0.025 + 0.06 * irr) * exp(-d / (0.12 + 0.12 * irr)) + 0.02 * exp(-d / 0.5));   // up 3 cm here, 8 there: never a level line on the bark
          #ifdef HERO
            if (aDry > -0.5) { vec2 wq = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz; float dd = texture2D(tDisp, vec2(wq.x, -wq.y) / 2.0).r;
              transformed.y += (dd - 0.5) * 0.014 * clamp(aLift, 0.0, 1.0) * (1.0 - 0.6 * smoothstep(0.35, 0.65, aDry)); }
          #endif
          vPit = vec3(mix(1.0, d, step(0.01, aPit.x)), aLift, irr); vPit2 = vec3(aPit.x, aPit.y, aPit.w); vDry = aDry; vLoc = transformed;
        }
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vSunL = uSunDir * mat3(modelMatrix * instanceMatrix);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSunL = uSunDir;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPit; varying vec3 vPit2; varying float vDry; varying vec3 vLoc; varying vec3 vSunL; uniform sampler2D tSoil; uniform sampler2D tSoilN;
        #ifdef HERO
          uniform sampler2D tChips; uniform sampler2D tChipsN; uniform sampler2D tDirt; uniform sampler2D tDirtN; uniform sampler2D tDisp; float heroE; vec2 heroUV; float heroSh;
          // the mulch scan's height map traced per pixel (2 cm deep): the chips overlap each other at a low view and cast their own little shadows
          vec2 heroTrace(vec2 uv, vec3 V) {
            vec2 st = vec2(V.x, -V.z) / max(V.y, 0.2) * 0.02 / 2.0 / 10.0; float d = 0.0, h = 1.0;
            for (int i = 0; i < 10; i++) { h = texture2D(tDisp, uv).r; if (1.0 - h <= d) break; uv -= st; d += 0.1; }
            return uv;
          }
          float heroShadow(vec2 uv, vec3 L) {
            float h0 = texture2D(tDisp, uv).r, s = 0.0; vec2 st = vec2(L.x, -L.z) / max(L.y, 0.15) * 0.02 / 2.0 / 6.0;
            for (int i = 1; i <= 6; i++) { float hh = texture2D(tDisp, uv + st * float(i)).r - (h0 + float(i) / 6.0); s = max(s, clamp(hh * 8.0, 0.0, 1.0)); }
            return s;
          }
        #endif
        ${COMMON_FRAG}
        ${PIT_SHADOW_GLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (vDry > -0.5) {   // soil: the photographed soil's own relief
          #ifdef HERO
            vec2 hw = vec2(vWPos.x, -vWPos.z);
            vec3 sn = (mix(texture2D(tChipsN, heroUV).xyz, texture2D(tDirtN, hw / 3.0).xyz, heroE) * 2.0 - 1.0) * vec3(0.75, 0.75, 1.0);
          #else
            vec3 sn = texture2D(tSoilN, vWPos.xz / 0.85).xyz * 2.0 - 1.0;
          #endif
          vec3 nW = normalize(inverseTransformDirection(normal, viewMatrix) + vec3(sn.x, 0.0, -sn.y) * mix(1.4, 0.7, smoothstep(0.45, 0.6, vDry)));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${BAKE_READ}
          vec2 w = vWPos.xz; float big = fbm(w * 1.3);
          #ifdef HERO
          if (vDry > -0.5) {
            vec2 hw = vec2(w.x, -w.y);
            heroE = 0.0;   // all mulch (the dirt patches read as stamped discs)
            heroUV = heroTrace(hw / 2.0, normalize(cameraPosition - vWPos)); heroSh = heroShadow(heroUV, normalize(uSunDir)) * (1.0 - heroE);
            vec3 chips = texture2D(tChips, heroUV).rgb, dirt = texture2D(tDirt, hw / 3.0).rgb;
            float cl = dot(chips, vec3(0.333)), dl = dot(dirt, vec3(0.333));
            diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.0, 0.16, vPit.x);   // damp, shaded mulch heaped against the trunk
            diffuseColor.rgb *= mix(mix(vec3(cl), chips, 0.62) * vec3(0.86, 0.84, 0.82), mix(vec3(dl), dirt, 0.5) * vec3(0.62, 0.60, 0.58), heroE);
          } else
          #endif
          if (vDry > -0.5) {
            // the pit floor is flat, dusty, trodden dirt with grit; black compost (ambientCG Ground048) lies on it in patches with a ragged, crumbly edge
            vec3 st = texture2D(tSoil, w / 0.85).rgb; float sl = dot(st, vec3(0.333));
            float e = smoothstep(0.496, 0.504, vDry + (fbm(w * 6.0) - 0.5) * 0.22 + (fbm(w * 27.0) - 0.5) * 0.1);
            vec3 st2 = texture2D(tSoil, w.yx / 2.3 + 0.37).rgb; float s2 = dot(st2, vec3(0.333)) * 0.5 + dot(texture2D(tSoil, w / 0.31 + 0.2).rgb, vec3(0.333)) * 0.5;
            float scuff = smoothstep(0.5, 0.75, fbm(vec2(w.x * 2.6 + w.y * 1.1, w.y * 7.5)));
            float grit = smoothstep(0.62, 0.8, s2 * 2.2) * 0.3;
            vec3 dryC = vec3(0.092, 0.078, 0.060) * (0.6 + 1.6 * s2) * (0.86 + 0.3 * scuff) * (0.85 + 0.3 * big) * (1.0 - grit);
            diffuseColor.rgb *= mix(mix(vec3(sl), st, 0.6) * vec3(0.40, 0.41, 0.42), dryC, e);
          } else {
            float mid = fbm(w * 9.0), fine = vnoise(w * 46.0);
            float iron = step(diffuseColor.r, 0.05) * step(diffuseColor.r * 1.05, diffuseColor.b);
            float stone = step(0.1, diffuseColor.r) * step(diffuseColor.r, 0.45) * step(diffuseColor.g, diffuseColor.r * 1.04) * step(diffuseColor.r, diffuseColor.g * 1.12);
            diffuseColor.rgb *= 0.6 + 0.8 * mix(mid, fine, 0.5);
            // granite: speckle, grime; iron: scuffed paint, rust where it has chipped
            diffuseColor.rgb *= mix(1.0, 0.75 + 0.5 * vnoise(w * 160.0), stone) * mix(1.0, 0.7 + 0.45 * big, stone);
            float rust = iron * smoothstep(0.5, 0.62, fbm(vLoc.xz * 5.0 + w * 1.3) * 0.45 + fbm(vLoc.xy * 31.0 + vLoc.zy * 27.0) * 0.25 + (0.1 - vLoc.y) * 2.6 + 0.3 * smoothstep(0.47, 0.5, vLoc.y)) * 0.9;   // rust low down, where rain and dogs get at it
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.042, 0.02) * (0.6 + 0.8 * fine), rust);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.062, 0.066), iron * (1.0 - rust) * smoothstep(0.6, 0.75, fbm(vLoc.xy * 9.0 + vLoc.zy * 11.0 + w * 3.0)) * 0.7);
          }
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          // hard sun shadows of the trunk and the guard on soil and rim
          float sh = pitShadow(vLoc, vSunL, vPit2);
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          #ifdef HERO
            if (vDry > -0.5) { reflectedLight.directDiffuse *= 1.0 - 0.85 * heroSh; reflectedLight.directSpecular *= 1.0 - heroSh; }
          #endif
          float kS = 1.0 - 0.7 * sh * lit;
          reflectedLight.directDiffuse *= kS; reflectedLight.indirectDiffuse *= kS; reflectedLight.directSpecular *= 1.0 - sh; reflectedLight.indirectSpecular *= kS;
        }`);
  };
  m.customProgramCacheKey = () => 'stTreePit20' + (hero ? 'h' : '') + (PIT3 ? '3' : '') + MK;
  return m;
}


// A hero pit is a hole in the paving: the soil lies below the slab, sunk about 6 cm at the cut and heaped up to the trunk. The paving
// itself is another part's mesh and is not cut; instead the pit is one quad at paving level whose every pixel is traced down into the
// hole (a height field: sawn slab edge with bites out of it, the cut's face, mulch from the scan's own height map, banked against the
// cut in places), so the far face of the cut shows, the near edge hides the soil behind it, and the slab's edge throws its sun shadow.
function sunkPitMaterial(shared, T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -8;   // other parts lay slabs, joints and stains a few millimetres over the paving
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tChips: { value: T.chips }, tChipsN: { value: T.chipsN }, tDisp: { value: T.disp } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPit; attribute vec2 aHalf; attribute float aKerb; varying float vKerb; varying vec4 vPit; varying vec2 vHalf; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vViewL; varying vec3 vAxX; varying vec3 vAxZ; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat4 tM = modelMatrix * instanceMatrix; vPit = aPit; vHalf = aHalf; vKerb = aKerb; vLoc = position; vWPos = (tM * vec4(position, 1.0)).xyz;
          vSunL = uSunDir * mat3(tM); vViewL = (cameraPosition - vWPos) * mat3(tM); vAxX = normalize(mat3(tM) * vec3(1.0, 0.0, 0.0)); vAxZ = normalize(mat3(tM) * vec3(0.0, 0.0, 1.0)); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vPit; varying vec2 vHalf; varying float vKerb; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vViewL; varying vec3 vAxX; varying vec3 vAxZ;
        ${COMMON_FRAG}
        ${MULCH_GLSL}
        ${PIT_SHADOW_GLSL}
        const float PD = 0.06;
        vec2 skQ; float skH; float skWall; float skSh; vec3 skN; float skAo;
        float pEdge(vec2 q) {   // > 0 inside the hole
          float d = min(vHalf.x - abs(q.x), vHalf.y - abs(q.y));
          if (d > 0.09) return d;
          float s = vPit.z * 37.0;
          d += -0.004 + (vnoise(q * 5.0 + s) - 0.5) * 0.010 + (vnoise(q * 31.0 + s) - 0.5) * 0.006;   // a sawn edge, chipped a little
          return d;
        }
        float pH(vec2 q, float lod) {   // height of what is there, metres from the paving (0 = the slab)
          if (pEdge(q) < 0.0) return 0.0;
          float d0 = min(vHalf.x - abs(q.x), vHalf.y - abs(q.y)), r = length(q - vec2(0.0, vPit.y));
          float mnd = 0.3 + 0.7 * smoothstep(vPit.x * 0.85, vPit.x + 0.45, r);
          float bank = (1.0 - smoothstep(0.0, 0.30, d0)) * (0.50 + 0.36 * vnoise(q * 3.4 + vPit.z * 11.0));   // the mulch lies level with the paving at the cut, a little under it here, over it there
          ${WC3 ? 'float chips = textureLod(tDisp, muv(q, vPit.z), lod).b; return min(-0.0015, -PD * mnd * (1.0 - min(bank, 1.0)) + (chips - ' + (PHOTO ? '0.40) * 0.034' : '0.52) * 0.065') + ');'
            : 'float chips = textureLod(tDisp, (q + vPit.z * 7.0) / MS, lod).r; return min(-0.0015, -PD * mnd * (1.0 - min(bank, 1.0)) + (chips - 0.62) * 0.024);'}
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${BAKE_READ}
          vec2 q0 = vLoc.xz; float e0 = pEdge(q0), spill = 0.0;
          if (e0 < 0.0) {
            discard;   // (the mulch kicked over the paving is the spill layer's: spillMaterial)
            // outside the cut the mulch has been kicked and washed over the paving: all of it at the edge, thinning to single chips
            // (the tallest of the scan's own height map) a hand's width out, further on one side than the other; soil crumbs between
            float dOut = -e0, reach = 0.05 + 0.26 * smoothstep(0.25, 0.8, vnoise(q0 * 1.3 + vPit.z * 23.0)) + 0.05 * vnoise(q0 * 7.0);
            float amt = 1.0 - smoothstep(0.0, reach, dOut), hC = texture2D(tDisp, (q0 + vPit.z * 7.0) / MS).r;
            float crumb = step(1.0 - 0.10 * amt, vnoise(q0 * 420.0 + 3.0)) * step(0.5, vnoise(q0 * 90.0));
            float thr = mix(0.95, 0.66, amt * amt);   // loose chips, never a carpet: the paving shows between them right up to the cut
            if (hC < thr && crumb < 0.5) discard;
            spill = hC < thr ? 2.0 : 1.0;
          }
          vec3 Vv = normalize(vViewL); vec2 st = -Vv.xz / max(Vv.y, 0.09);
          float lod = clamp(log2(length(vViewL) * 0.5 * 2.0 / MS), 0.0, 6.0);
          float dt = PD * 1.2 / 16.0, t = 0.0, tH = PD * 1.2;
          if (spill > 0.5) tH = 0.0; else for (int i = 0; i < 16; i++) { t += dt; if (-t <= pH(q0 + st * t, lod)) { float a = t - dt, b = t; for (int k = 0; k < 4; k++) { float md = 0.5 * (a + b); if (-md <= pH(q0 + st * md, lod)) b = md; else a = md; } tH = b; break; } }
          skQ = q0 + st * tH; skH = -tH;
          float e = pEdge(skQ), r = length(skQ - vec2(0.0, vPit.y)); skWall = spill > 0.5 ? 0.0 : step(e, 0.0);
          vec2 uvc = muv(skQ, vPit.z);
          vec3 cF = mulchCol(uvc, lod, skQ, vPit.z, r - vPit.x);
          vec3 cW = vec3(0.21, 0.195, 0.175) * (0.6 + 0.8 * vnoise(skQ * 60.0 + skH * 190.0)) * mix(1.0, 0.4, smoothstep(PD * 0.2, PD * 0.8, tH + (vnoise(skQ * 23.0) - 0.5) * 0.03));   // the cut's face: concrete gone dark with soil and damp
          diffuseColor.rgb = mix(cF, cW, skWall);
          if (spill > 1.5) diffuseColor.rgb = vec3(0.060, 0.050, 0.040) * (0.6 + 0.8 * vnoise(q0 * 900.0));   // a crumb of soil
          skAo = spill > 0.5 ? 0.9 : mix((0.72 + 0.28 * smoothstep(0.0, 0.05, e)) * (${PIT2 ? '0.25 + 0.75 * smoothstep(0.0, 0.07, r - vPit.x)' : '0.5 + 0.5 * smoothstep(0.0, 0.10, r - vPit.x)'}), 0.6, skWall);
          ${WC3 && !PHOTO ? 'if (spill < 0.5) skAo *= mix(1.0, mix(0.35, 1.0, textureLod(tDisp, uvc, lod).g), 1.0 - skWall);' : ''}
          vec3 cn = textureLod(tChipsN, uvc, lod).xyz * 2.0 - 1.0;${SUNM ? ' cn *= 0.0;' : ''} vec2 away = (skQ - vec2(0.0, vPit.y)) / max(r, 1e-3);
          float mr = smoothstep(vPit.x * 0.85, vPit.x + 0.45, r);
          vec3 nF = normalize(vec3(cn.x * 1.5 + away.x * 0.16 * mr * (1.0 - mr) * 4.0, 1.0, -cn.y * 1.5 + away.y * 0.16 * mr * (1.0 - mr) * 4.0));
          vec2 g = vec2(pEdge(skQ + vec2(0.004, 0.0)) - pEdge(skQ - vec2(0.004, 0.0)), pEdge(skQ + vec2(0.0, 0.004)) - pEdge(skQ - vec2(0.0, 0.004)));
          vec3 nWl = normalize(vec3(g.x, 0.0, g.y) / max(length(g), 1e-5) + vec3(0.0, 0.3, 0.0));
          skN = mix(nF, nWl, skWall);
          // the slab's edge and the heaped mulch shade the soil: walk from the soil toward the sun until the paving level
          vec3 Ls = normalize(vSunL); skSh = 0.0;
          if (Ls.y > 0.05 && skWall < 0.5 && spill < 0.5) { vec2 ls = Ls.xz / Ls.y; float up = -skH;
            for (int i = 1; i <= 8; i++) { float sI = up * float(i) / 8.0; if (pH(skQ + ls * sI, lod) > skH + sI + 0.002) { skSh = 1.0; break; } } }
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 nW = normalize(vAxX * skN.x + vec3(0.0, 1.0, 0.0) * skN.y + vAxZ * skN.z); normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float sh = pitShadow(vec3(skQ.x, 0.0, skQ.y), vSunL, vec3(vPit.x, vPit.y, vPit.w));
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float kS = 1.0 - ${PIT3 || SEAT ? '0.97' : '0.93'} * sh * lit;
          reflectedLight.directDiffuse *= kS * (1.0 - skSh); reflectedLight.indirectDiffuse *= mix(1.0, kS, ${PIT3 || SEAT ? '0.72' : '0.5'}) * skAo * mix(1.0, 0.8, skSh);
          reflectedLight.directSpecular *= (1.0 - sh) * (1.0 - skSh); reflectedLight.indirectSpecular *= kS * skAo;
        }`);
  };
  m.customProgramCacheKey = () => (PITALL ? 'A' + PDK[0] : '') + 'stTreePitSunk15' + (MPATH ? 'p' : WC3 ? 'w' : '') + (PIT3 ? '3' : '') + (PIT2 ? '2' : '') + (MDARK ? 'm' : '') + MK;
  return m;
}

// What the mulch does outside the cut: single chips kicked over the paving (the scan's own tallest chips, each with the sliver of
// shade it throws), thick at the edge and thinning out within a hand or two, further on one side than the other, on a soft stain
// of soil dust. A blended layer just over the paving, so its edges are soft and the paving shows between the chips.
function spillMaterial(shared, T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, transparent: true, depthWrite: false });
  m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -10;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tChips: { value: T.chips }, tChipsN: { value: T.chipsN }, tDisp: { value: T.disp } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPit; attribute vec2 aHalf; attribute float aKerb; varying float vKerb; varying vec4 vPit; varying vec2 vHalf; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vSunL; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat4 tM = modelMatrix * instanceMatrix; vPit = aPit; vHalf = aHalf; vKerb = aKerb; vLoc = position; vWPos = (tM * vec4(position, 1.0)).xyz; vSunL = uSunDir * mat3(tM); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vPit; varying vec2 vHalf; varying float vKerb; varying vec3 vLoc; varying vec3 vSunL;
        ${COMMON_FRAG}
        ${MULCH_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${BAKE_READ}
          vec2 q = vLoc.xz; float d = max(abs(q.x) - vHalf.x, abs(q.y) - vHalf.y);
          if (d < -0.004 || q.y > vKerb - 0.03) discard;
          float dOut = max(d, 0.0), reach = 0.06 + 0.30 * smoothstep(0.25, 0.8, vnoise(q * 1.3 + vPit.z * 23.0)) + 0.05 * vnoise(q * 7.0), amt = 1.0 - smoothstep(0.0, reach, dOut);
          vec2 uvc = muv(q, vPit.z); float thr = mix(0.97, 0.62, amt * amt), a = smoothstep(thr, thr + 0.03, texture2D(tDisp, uvc).r);
          vec2 sd = vSunL.xz / max(length(vSunL.xz), 1e-4) * 0.008 / MS; float aS = smoothstep(thr, thr + 0.03, texture2D(tDisp, uvc + sd).r);
          { vec2 u2 = uvc.yx * 1.13 + 0.37; float far = 1.0 - smoothstep(0.22, 0.42, dOut), t2 = 0.905;   // loose pieces tracked further out
            a = max(a, smoothstep(t2, t2 + 0.03, texture2D(tDisp, u2).r) * far); aS = max(aS, smoothstep(t2, t2 + 0.03, texture2D(tDisp, u2 + sd.yx * 1.13).r) * far); }
          float stain = amt * (0.22 * amt + 0.42 * smoothstep(0.35, 0.7, fbm(q * 5.0 + vPit.z * 3.0))), sh = aS * (1.0 - a) * 0.6, under = max(stain, sh);
          float alpha = a + (1.0 - a) * under; if (alpha < 0.02) discard;
          vec3 dirt = vec3(0.070, 0.058, 0.046) * (0.7 + 0.6 * vnoise(q * 140.0)) * (1.0 - 0.75 * sh / max(under, 1e-3));
          diffuseColor.rgb = mix(dirt, mulchCol(uvc, 0.0, q, vPit.z, 1.0), a / alpha); diffuseColor.a = alpha;
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL);
  };
  m.customProgramCacheKey = () => (PITALL ? 'A' + PDK[0] : '') + 'stTreeSpill5' + (MPATH ? 'p' : WC3 ? 'w' : '') + (PIT3 ? '3' : '') + (PIT2 ? '2' : '') + (MDARK ? 'm' : '') + MK;
  return m;
}

// Loose chips of the mulch as real pieces: in the hole (standing on the traced soil) and spilled over the cut onto the paving.
// Each is a thin splinter, one end kicked up, with the shadow it throws laid beside it (the shadow map is too coarse for a 5 cm chip).
function chipsGeometry(L, Wd, seed) {
  const R = rng(seed), P = [], C = [], K = [], I = [], hx = L / 2, hz = Wd / 2;
  const tones = [[0.36, 0.27, 0.17], [0.30, 0.22, 0.135], [0.24, 0.17, 0.10], [0.28, 0.23, 0.17], [0.13, 0.09, 0.06], [0.40, 0.31, 0.20], [0.20, 0.14, 0.09]];
  const add = (x, z, out) => {
    const a = R() * 6.283, c = Math.cos(a), s = Math.sin(a), l = (0.010 + 0.030 * R() * R() + (R() < 0.05 ? 0.03 : 0)) * (out ? 0.8 : 1), w = l * (0.14 + 0.3 * R()), th = 0.003 + 0.006 * R(), up = R() < 0.6 ? 0.004 + 0.022 * R() * R() : 0, t = tones[Math.floor(R() * tones.length)], k = 0.7 + 0.5 * R();
    const j = () => 0.7 + 0.6 * R(), o = P.length / 3, col = [t[0] * k, t[1] * k, t[2] * k];
    const top = [[-l * j(), th, -w * j()], [-l * j(), th, w * j()], [l * j(), th + up, w * j()], [l * j(), th + up, -w * j()]].map((v) => [x + v[0] * c - v[2] * s, v[1], z + v[0] * s + v[2] * c]);
    // top face, skirt to the ground, then the shadow patch (kind 1: moved along the sun's ground direction by its height in the shader)
    for (const v of top) { P.push(v[0], v[1], v[2]); C.push(col[0], col[1], col[2]); K.push(out ? 2 : 0, 0, x, z); }
    for (const v of top) { P.push(v[0], 0, v[2]); C.push(col[0] * 0.3, col[1] * 0.3, col[2] * 0.3); K.push(out ? 2 : 0, 0, x, z); }
    for (const v of top) { P.push(v[0], 0.0012, v[2]); C.push(0.012, 0.010, 0.008); K.push(out ? 3 : 1, v[1], x, z); }
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
    for (let q = 0; q < 4; q++) { const n = (q + 1) % 4; I.push(o + q, o + 4 + q, o + 4 + n, o + q, o + 4 + n, o + n); }
    I.push(o + 8, o + 9, o + 10, o + 8, o + 10, o + 11);
  };
  // what else lies and grows in a street pit: fallen twigs and leaves, weeds at the cut and in the corners, a few cigarette ends
  const flat3 = (pts, col, cx, cz, kind, cols) => { const o = P.length / 3; pts.forEach((v, i) => { P.push(v[0], v[1], v[2]); const k = cols ? cols[i] : 1; C.push(col[0] * k, col[1] * k, col[2] * k); K.push(kind, 0, cx, cz); }); for (let i = 1; i < pts.length - 1; i++) I.push(o, o + i, o + i + 1); };
  const tuft = (x, z, out) => { const nb = 8 + Math.floor(R() * 16), hgt = 0.04 + 0.2 * R() * R(), g = 0.6 + 0.7 * R(), dry = R() < 0.2, kind = out ? 2 : 0;
    for (let b = 0; b < nb; b++) { const a = R() * 6.283, ca = Math.cos(a), sa = Math.sin(a), h = hgt * (0.4 + 0.8 * R()), lean = 0.25 + 0.9 * R(), w = 0.0025 + 0.004 * R(), bx = x + (R() - 0.5) * 0.05, bz = z + (R() - 0.5) * 0.05;
      const col = dry || R() < 0.15 ? [0.20 * g, 0.17 * g, 0.08 * g] : R() < 0.5 ? [0.045 * g, 0.085 * g, 0.03 * g] : [0.065 * g, 0.105 * g, 0.032 * g];
      const pt = (f) => [bx + ca * lean * f * f * h, h * f * (1 - 0.3 * lean * f), bz + sa * lean * f * f * h], p1 = pt(0.45), p2 = pt(1), tx = -sa * w, tz = ca * w;
      flat3([[bx - tx, -0.01, bz - tz], [bx + tx, -0.01, bz + tz], [p1[0] + tx * 0.8, p1[1], p1[2] + tz * 0.8], [p1[0] - tx * 0.8, p1[1], p1[2] - tz * 0.8]], col, x, z, kind, [0.3, 0.3, 0.85, 0.85]);
      flat3([[p1[0] - tx * 0.8, p1[1], p1[2] - tz * 0.8], [p1[0] + tx * 0.8, p1[1], p1[2] + tz * 0.8], p2], col, x, z, kind, [0.85, 0.85, 1.15]); } };
  const nT = 0; for (let i = 0; i < nT; i++) { const sd = Math.floor(R() * 4), u = (R() * 2 - 1) * 0.95, d = 0.03 + 0.12 * R() * R(); if (sd < 2) tuft(u * hx, (sd ? 1 : -1) * (hz - d), false); else tuft((sd === 2 ? 1 : -1) * (hx - d), u * hz, false); }
  if (false) { const sd = Math.floor(R() * 4), u = (R() * 2 - 1) * 0.9; if (sd < 2) tuft(u * hx, (sd ? 1 : -1) * (hz + 0.012), true); else tuft((sd === 2 ? 1 : -1) * (hx + 0.012), u * hz, true); }   // one in the joint at the cut
  const nTw = 0; for (let i = 0; i < nTw; i++) { const x = (R() * 2 - 1) * (hx - 0.15), z = (R() * 2 - 1) * (hz - 0.15), a = R() * 6.283, l = 0.06 + 0.16 * R(), w = 0.002 + 0.003 * R(), k = 0.6 + 0.6 * R(), c = Math.cos(a), sn = Math.sin(a), bend = (R() - 0.5) * 0.06, y = 0.006 + 0.01 * R();
    const mid = [x + sn * bend, y + 0.004, z - c * bend], e0 = [x - c * l, y, z - sn * l], e1 = [x + c * l, y + 0.012 * R(), z + sn * l], col = [0.085 * k, 0.065 * k, 0.05 * k];
    for (const [A, B] of [[e0, mid], [mid, e1]]) { flat3([[A[0] - sn * w, A[1], A[2] + c * w], [A[0] + sn * w, A[1], A[2] - c * w], [B[0] + sn * w, B[1], B[2] - c * w], [B[0] - sn * w, B[1], B[2] + c * w]], col, x, z, 0, [1, 0.7, 0.7, 1]);
      flat3([[A[0] - sn * w * 2.2 , 0.0015, A[2] + c * w * 2.2], [A[0] + sn * w * 2.2, 0.0015, A[2] - c * w * 2.2], [B[0] + sn * w * 2.2, 0.0015, B[2] - c * w * 2.2], [B[0] - sn * w * 2.2, 0.0015, B[2] + c * w * 2.2]], [0.012, 0.010, 0.008], x, z, 1); } }
  const nLf = 0; for (let i = 0; i < nLf; i++) { const out = R() < 0.25, d = 0.02 + 0.3 * R() * R(), sd = Math.floor(R() * 4), u = R() * 2 - 1;
    const x = out ? (sd < 2 ? u * hx : (sd === 2 ? 1 : -1) * (hx + d)) : (R() * 2 - 1) * (hx - 0.06), z = out ? (sd < 2 ? (sd ? 1 : -1) * (hz + d) : u * hz) : (R() * 2 - 1) * (hz - 0.06);
    const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), l = 0.022 + 0.02 * R(), w = l * (0.55 + 0.3 * R()), k = 0.5 + 0.5 * R(), tn = R(), cu = 0.004 + 0.012 * R(), y = 0.005;
    const col = tn < 0.45 ? [0.20 * k, 0.15 * k, 0.07 * k] : tn < 0.8 ? [0.13 * k, 0.09 * k, 0.05 * k] : [0.10 * k, 0.12 * k, 0.045 * k];
    flat3([[x - c * l, y, z - sn * l], [x - sn * w, y + cu, z + c * w], [x + c * l, y + cu * 0.4, z + sn * l], [x + sn * w, y + cu * 0.7, z - c * w]], col, x, z, out ? 2 : 0, [0.8, 1.05, 1, 0.9]); }
  const nBt = 0; for (let i = 0; i < nBt; i++) { const out = R() < 0.3, x = (R() * 2 - 1) * (hx + (out ? 0.25 : -0.06)), z = out ? (R() < 0.5 ? -1 : 1) * (hz + 0.03 + 0.2 * R()) : (R() * 2 - 1) * (hz - 0.06), a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), l = 0.011, w = 0.0037, y = 0.007, k = 0.7 + 0.3 * R();
    const q = (u0, u1) => [[x + c * u0 - sn * w, y, z + sn * u0 + c * w], [x + c * u0 + sn * w, y, z + sn * u0 - c * w], [x + c * u1 + sn * w, y, z + sn * u1 - c * w], [x + c * u1 - sn * w, y, z + sn * u1 + c * w]];
    flat3(q(-l, 0), [0.34 * k, 0.22 * k, 0.10 * k], x, z, out ? 2 : 0); flat3(q(0, l * (0.5 + R())), [0.42 * k, 0.40 * k, 0.36 * k], x, z, out ? 2 : 0); }
  if (SLABS) {   // thin splintered plates, pale dry wood like the scan's top chips, each with the shade it throws
    const tonesS = TONE ? [[0.50, 0.38, 0.24], [0.42, 0.31, 0.19], [0.40, 0.25, 0.13], [0.33, 0.20, 0.10], [0.36, 0.27, 0.17], [0.20, 0.145, 0.10], [0.30, 0.275, 0.24], [0.46, 0.33, 0.20], [0.27, 0.17, 0.09]] : [[0.50, 0.38, 0.24], [0.42, 0.31, 0.19], [0.56, 0.45, 0.30], [0.36, 0.27, 0.17], [0.46, 0.36, 0.25]];
    const plate = (x, z, stick) => { const l = stick ? 0.05 + 0.06 * R() : SLABS2 ? 0.012 + 0.022 * R() * R() + 0.006 * R() : 0.022 + 0.03 * R(), w = l * (stick ? 0.05 + 0.05 * R() : 0.28 + 0.3 * R()), a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), t = tonesS[Math.floor(R() * tonesS.length)], k = (SLABS2 ? 0.6 : 0.8) + (SLABS2 ? 0.7 : 0.4) * R(), y0 = (TONE ? 0.007 : 0.004) + (TONE ? 0.011 : 0.006) * R(), tilt = SLABS2 ? (R() - 0.3) * 0.02 : (R() - 0.5) * 0.012, nv = 5 + Math.floor(R() * 3), a0 = R() * 6.283, pts = [];
      for (let q = 0; q < nv; q++) { const b = a0 + (q + (R() - 0.5) * 0.6) / nv * 6.283, rr = 0.65 + 0.35 * R(), u = Math.cos(b) * l * rr, v = Math.sin(b) * w * rr; pts.push([x + u * c - v * sn, y0 + tilt * u / l, z + u * sn + v * c, SLABS2 ? 0.75 + 0.5 * R() : 1]); }
      for (const kind of [1, 0]) { const o = P.length / 3; for (const v of pts) { if (kind) { P.push(v[0], 0.0012, v[2]); C.push(0.014, 0.011, 0.009); K.push(1, Math.max(v[1], 0.002), x, z); } else { P.push(v[0], v[1], v[2]); { const tl = (t[0] + t[1] + t[2]) / 3, g = PITALL ? 0.45 : 0; C.push((t[0] + (tl - t[0]) * g) * k * v[3] * (PITALL ? 0.62 * PDK[0] : MDARK ? 0.8 : 1), (t[1] + (tl - t[1]) * g) * k * v[3] * (PITALL ? 0.62 * PDK[1] : MDARK ? 0.74 : 1), (t[2] + (tl - t[2]) * g) * k * v[3] * (PITALL ? 0.62 * PDK[2] : MDARK ? 0.7 : 1)); } K.push(0, 0, x, z); } } for (let q = 1; q < nv - 1; q++) I.push(o, o + q, o + q + 1); } };
    const nS = Math.round(L * Wd * (SLABS3 ? 480 : SLABS2 ? 190 : 55)), nK = Math.round(L * Wd * 14);
    for (let i = 0; i < nS; i++) plate((R() * 2 - 1) * (hx - 0.06), (R() * 2 - 1) * (hz - 0.06), false);
    for (let i = 0; i < nK; i++) plate((R() * 2 - 1) * (hx - 0.1), (R() * 2 - 1) * (hz - 0.1), true); }
  const nIn = 0;   // (r10: loose chips as pieces read as props; the mulch itself carries the chips) for (let i = 0; i < nIn; i++) add((R() * 2 - 1) * (hx - 0.05), (R() * 2 - 1) * (hz - 0.05), false);
  const nOut = 0; for (let i = 0; i < nOut; i++) { const d = 0.012 + 0.30 * R() * R() * R(), sd = Math.floor(R() * 4), u = R() * 2 - 1;
    if (sd < 2) add(u * (hx + d), (sd ? 1 : -1) * (hz + d), true); else add((sd === 2 ? 1 : -1) * (hx + d), u * (hz + d), true); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aChip', new THREE.Float32BufferAttribute(K, 4)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
function chipsMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { uProj: PROJ });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPit; attribute vec4 aChip; attribute vec2 aHalf; varying vec3 vWPos; uniform vec3 uSunDir; varying vec3 vOrg; varying vec3 vAxX; varying vec3 vAxZ; varying vec3 vCh; varying vec3 vSunLc; varying vec3 vLocC; varying vec4 vPitC;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat4 tM = modelMatrix * instanceMatrix; vec3 sl = uSunDir * mat3(tM);
          float r = length(aChip.zw - vec2(0.0, aPit.y)), inside = step(aChip.x, 1.5);   // the whole chip takes its place from its middle
          // in the hole a chip stands on the soil there (6 cm down at the cut, heaped toward the trunk); on the paving it lies on the slab
          float base = mix(0.006, -0.06 * (0.3 + 0.7 * smoothstep(aPit.x * 0.85, aPit.x + 0.45, r)) + 0.016, inside);
          transformed.y += base;
          if (mod(aChip.x, 2.0) > 0.5) transformed.xz -= sl.xz / max(sl.y, 0.2) * (aChip.y + 0.004);        // the shadow patch
          if (r < aPit.x + 0.01) transformed = vec3(0.0, -1.0, 0.0);                                         // none inside the trunk
          vWPos = (tM * vec4(transformed, 1.0)).xyz; vOrg = tM[3].xyz; vAxX = normalize(mat3(tM) * vec3(1.0, 0.0, 0.0)); vAxZ = normalize(mat3(tM) * vec3(0.0, 0.0, 1.0)); vCh = vec3(aHalf, inside); vSunLc = sl; vLocC = transformed; vPitC = aPit; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n ${COMMON_FRAG}\n ${SLAB_GLSL}\n ${PIT_SHADOW_GLSL}\n varying vec3 vOrg; varying vec3 vAxX; varying vec3 vAxZ; varying vec3 vCh; varying vec3 vSunLc; varying vec3 vLocC; varying vec4 vPitC;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { ${BAKE_READ} diffuseColor.rgb *= 0.8 + 0.4 * vnoise(vWPos.xz * 300.0);${PHOTO ? ' diffuseColor.rgb *= vec3(0.50, 0.37, 0.27) * ' + MG + ';' : ''}
          if (vCh.z > 0.5) {   // a chip down in the hole is seen only through the hole: where its line of sight crosses the paving outside the cut, the slab hides it
            vec3 rd = vWPos - cameraPosition; float tP = (0.154 - cameraPosition.y) / min(rd.y, -1e-4); vec3 dl = cameraPosition + rd * tP - vOrg;
            if (abs(dot(dl, vAxX)) > vCh.x - 0.012 || abs(dot(dl, vAxZ)) > vCh.y - 0.012) discard; }
          slabDepth(vWPos); }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        { float sh = pitShadow(vec3(vLocC.x, 0.0, vLocC.z), vSunLc, vec3(vPitC.x, vPitC.y, vPitC.w)); float kS = 1.0 - 0.93 * sh;
          reflectedLight.directDiffuse *= kS; reflectedLight.directSpecular *= kS; reflectedLight.indirectDiffuse *= mix(1.0, kS, 0.5); }`);
  };
  m.customProgramCacheKey = () => 'stTreeChips7' + (PIT3 ? '3' : '') + MK;
  return m;
}

// Round 16: the mulch as a PILE OF REAL CHIPS. Every chip is its own thin splintered plate (3-10 cm, a few 15 cm slivers), lying at its
// own tilt in a heap that stands a little proud of the paving, highest at the trunk, thinning to single chips kicked over the cut.
// Each chip carries a dark copy just under it, pushed away from the sun: the shade it throws on the chips below (the shadow map
// cannot resolve a chip). Chips low in the heap are darker. The traced pit under it (sunkPitMaterial) is what shows in the gaps.
function chipBedGeometry(L, Wd, seed) {
  const R = rng(seed), hx = L / 2, hz = Wd / 2, P = [], N = [], C = [], K = [], U = [], I = [];
  // size: mostly small pieces (1.5-4 cm), some hand-sized slabs, a few long splinters; no two outlines alike, none a rectangle
  const chip = (cx, cz, hRel, kindC, flat) => {
    const l = kindC === 2 ? 0.04 + 0.05 * R() : kindC === 1 ? 0.018 + 0.022 * R() : 0.006 + 0.012 * R() * R() + 0.004 * R(), w = l * (kindC === 2 ? 0.06 + 0.07 * R() : kindC === 1 ? 0.3 + 0.35 * R() : 0.25 + 0.45 * R());
    const yaw = R() * 6.283, pitch = (R() - 0.5) * (flat ? 0.10 : kindC ? 0.25 : 0.7), roll = (R() - 0.5) * (flat ? 0.12 : 0.7), k = 0.8 + 0.4 * R(), tone = R(), warm = R();
    const nv = 5 + Math.floor(R() * 3), o2 = [], a0 = R() * 6.283;
    for (let q = 0; q < nv; q++) { const a = a0 + (q + (R() - 0.5) * 0.7) / nv * 6.283, rr = 0.62 + 0.38 * R(); o2.push([Math.cos(a) * l * rr, Math.sin(a) * w * rr]); }
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const tf = (u, v) => { const x1 = u * cp, y1 = u * sp + v * sr, z1 = v * cr; return [x1 * cy - z1 * sy, y1, x1 * sy + z1 * cy]; };
    const a = tf(1, 0), b = tf(0, 1); let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; if (n[1] < 0) n = n.map((v) => -v);
    const u0 = R(), v0 = R(), nk = flat || hRel < 0.55 ? 1 : 2;   // only the chips high in the heap throw a shade worth drawing
    for (let kind = 0; kind < nk; kind++) { const o = P.length / 3;
      for (const [u, v] of o2) { const q = tf(u, v); P.push(q[0], q[1], q[2]); N.push(n[0], n[1], n[2]); C.push(k, tone, warm); K.push(cx, cz, hRel, kind); U.push(u0 + u * 2.2, v0 + v * 2.2, u / l, v / w); }
      for (let q = 1; q < nv - 1; q++) I.push(o, o + q, o + q + 1); }
  };
  const nIn = Math.round(L * Wd * 6500);
  for (let i = 0; i < nIn; i++) { const t = R(); chip((R() * 2 - 1) * (hx - 0.012), (R() * 2 - 1) * (hz - 0.012), R(), t < 0.012 ? 2 : t < 0.06 ? 1 : 0, false); }
  // kicked over the cut: thick at the edge, single chips a hand or two out, further on one side than another
  const nOut = Math.round((L + Wd) * 2 * 260), far = [0.10 + 0.3 * R(), 0.10 + 0.3 * R(), 0.10 + 0.3 * R(), 0.10 + 0.3 * R()];
  for (let i = 0; i < nOut; i++) { const sd = Math.floor(R() * 4), u = R() * 2 - 1, d = far[sd] * R() * R() * (0.5 + 0.5 * Math.sin(u * 5 + sd * 2.1) ** 2);
    if (sd < 2) chip(u * (hx + d), (sd ? 1 : -1) * (hz + d), 0, 0, true); else chip((sd === 2 ? 1 : -1) * (hx + d), u * (hz + d), 0, 0, true); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aChip', new THREE.Float32BufferAttribute(K, 4)); g.setAttribute('aCuv', new THREE.Float32BufferAttribute(U, 4)); g.setIndex(I); return g;
}
function chipBedMaterial(shared, T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tChips: { value: T.chips } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPit; attribute vec4 aChip; attribute vec4 aCuv; attribute vec3 color; attribute vec2 aHalf; attribute float aKerb; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vSunL; varying vec4 vPit; varying vec3 vCk; varying vec4 vCuv; varying vec3 vTone; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat4 tM = modelMatrix * instanceMatrix; vec3 sl = normalize(uSunDir * mat3(tM)); vec2 q = aChip.xy;
          float d0 = min(aHalf.x - abs(q.x), aHalf.y - abs(q.y)), r = length(q - vec2(0.0, aPit.y)), R = aPit.x;
          // the heap: a finger deep at the cut, a hand deep in the middle, banked up the trunk
          float H = d0 > 0.0 ? 0.008 + 0.028 * smoothstep(0.0, 0.30, d0) + 0.075 * exp(-max(r - R, 0.0) / 0.16) * step(0.01, R) : 0.0;
          vec3 c = vec3(q.x, 0.003 + (0.12 + 0.88 * aChip.z) * H, q.y);
          if (aChip.w > 0.5) { transformed.y -= 0.004; c.xz -= sl.xz / max(sl.y, 0.3) * 0.004; }      // the shade it throws on what lies under it
          transformed += c;
          if (r < R * 0.9 || q.y > aKerb - 0.02) transformed = vec3(0.0, -1.0, 0.0);                  // none inside the trunk, none beyond the kerb
          vWPos = (tM * vec4(transformed, 1.0)).xyz; vLoc = transformed; vSunL = uSunDir * mat3(tM); vPit = aPit; vCk = vec3(aChip.z, aChip.w, r - R); vCuv = aCuv; vTone = color; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLoc; varying vec3 vSunL; varying vec4 vPit; varying vec3 vCk; varying vec4 vCuv; varying vec3 vTone; uniform sampler2D tChips;
        ${COMMON_FRAG}
        ${PIT_SHADOW_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { ${BAKE_READ}
          if (vLoc.y < -0.5) discard;
          // each chip takes its colour from one spot of the scanned mulch (so the heap has the scan's own mix of pale, golden, grey
          // and dark pieces), with the wood's grain along its length, a darker bevel at its edge, and the scan's fine dirt over it
          vec3 base = textureLod(tChips, vCuv.xy, 3.5).rgb; vec3 tx = texture2D(tChips, vCuv.xy).rgb; float tl = dot(tx, vec3(0.333)), bl = dot(base, vec3(0.333));
          vec3 c = mix(vec3(1.0), base / max(bl, 0.02), 0.55) * vec3(1.0, 0.93, 0.80) * mix(0.17, 0.40, vTone.y) * vTone.x;   // pale dry wood, straw to tan, the scan's own hue
          c = mix(c, vec3(dot(c, vec3(0.333))) * vec3(1.0, 0.97, 0.93), step(0.86, vTone.z) * 0.6);                 // weathered grey pieces
          c *= mix(1.0, 0.45, step(vTone.z, 0.07));                                                                    // dark bark pieces
          float grain = fbm(vec2(vCuv.z * 2.5 + vTone.y * 31.0, vCuv.w * 9.0 + vTone.z * 17.0));
          c *= (0.72 + 0.56 * grain) * clamp(0.6 + 1.3 * tl / max(bl, 0.03) * 0.35, 0.6, 1.5);
          c *= 0.8 + 0.2 * smoothstep(1.0, 0.6, length(vCuv.zw));                           // the broken edge
          c *= 0.62 + 0.38 * smoothstep(0.0, 0.10, vCk.z);                                                            // damp and dark against the bark
          if (vCk.y > 0.5) c = vec3(0.060, 0.047, 0.036) * (0.7 + 0.9 * tl);
          diffuseColor.rgb = c; }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float sh = pitShadow(vec3(vLoc.x, 0.0, vLoc.z), vSunL, vec3(vPit.x, vPit.y, vPit.w));
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float kS = 1.0 - 0.93 * sh * lit, ao = (0.55 + 0.45 * vCk.x) * (0.5 + 0.5 * smoothstep(0.0, 0.10, vCk.z));
          if (vCk.y > 0.5) { reflectedLight.directDiffuse *= 0.15; reflectedLight.directSpecular *= 0.0; }
          reflectedLight.directDiffuse *= kS * (0.78 + 0.22 * vCk.x); reflectedLight.indirectDiffuse *= mix(1.0, kS, 0.5) * ao; reflectedLight.directSpecular *= 1.0 - sh; reflectedLight.indirectSpecular *= kS * ao;
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeChipBed6';
  return m;
}

// Mulch heaped against the trunk: a low ring of real geometry round the foot (a few centimetres up the bark, to an uneven line),
// coloured like the traced soil and thinning into it at a ragged edge.
function moundGeometry() {
  const NA = 44, NR = 7, P = [], I = [];
  for (let j = 0; j <= NR; j++) for (let i = 0; i <= NA; i++) { const a = i / NA * 6.2831853; P.push(Math.cos(a), j / NR, Math.sin(a)); }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(P.map((v, k) => k % 3 === 1 ? 1 : 0), 3)); g.setIndex(I); return g;
}
function moundMaterial(shared, T) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tChips: { value: T.chips }, tChipsN: { value: T.chipsN }, tDisp: { value: T.disp }, uProj: PROJ });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPit; varying vec4 vPit; varying vec3 vWPos; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vViewL; varying vec3 vAxX; varying vec3 vAxZ; varying vec2 vMd; uniform vec3 uSunDir;
        ${NOISE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { mat4 tM = modelMatrix * instanceMatrix; float f = position.y, R = aPit.x, r = R * 0.7 + f * 0.30, ang = atan(position.z, position.x);
          float pile = ${SEAT ? '0.035' : BASE2 ? '0.16' : '0.10'} * exp(-max(r - R, 0.0) / ${BASE2 ? '0.12' : '0.09'}) * (${SEAT ? '0.7 + 0.3' : '0.2 + 0.8'} * vnoise(vec2(ang * 1.9 + aPit.z * 17.0, aPit.z * 3.0))) * step(0.01, R);
          transformed = vec3(position.x * r, -0.06 * (0.3 + 0.7 * smoothstep(R * 0.85, R + 0.45, r)) + 0.006 + pile, position.z * r + aPit.y);
          vPit = aPit; vLoc = transformed; vMd = vec2(f, pile); vWPos = (tM * vec4(transformed, 1.0)).xyz;
          vSunL = uSunDir * mat3(tM); vViewL = (cameraPosition - vWPos) * mat3(tM); vAxX = normalize(mat3(tM) * vec3(1.0, 0.0, 0.0)); vAxZ = normalize(mat3(tM) * vec3(0.0, 0.0, 1.0)); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vPit; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vViewL; varying vec3 vAxX; varying vec3 vAxZ; varying vec2 vMd; vec3 mdN;
        ${COMMON_FRAG}
        ${MULCH_GLSL}
        ${PIT_SHADOW_GLSL}
        ${SLAB_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${BAKE_READ}
          vec2 q = vLoc.xz; float r = length(q - vec2(0.0, vPit.y));
          if (vMd.x > 0.42 + 0.58 * vnoise(q * 16.0 + vPit.z * 9.0)) discard;      // it thins out into the soil around it
          float lod = clamp(log2(length(vViewL) * 0.5 * 2.0 / MS), 0.0, 6.0); vec2 uvc = muv(q, vPit.z);
          diffuseColor.rgb = mulchCol(uvc, lod, q, vPit.z, r - vPit.x);
          vec3 cn = textureLod(tChipsN, uvc, lod).xyz * 2.0 - 1.0;${SUNM ? ' cn *= 0.0;' : ''} vec2 away = (q - vec2(0.0, vPit.y)) / max(r, 1e-3); float sl = clamp(vMd.y / 0.10, 0.0, 1.0) * 0.9;
          mdN = normalize(vec3(cn.x * 0.9 + away.x * sl, 1.0, -cn.y * 0.9 + away.y * sl));
          slabDepth(vWPos);
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 nW = normalize(vAxX * mdN.x + vec3(0.0, 1.0, 0.0) * mdN.y + vAxZ * mdN.z); normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz); }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          float sh = pitShadow(vec3(vLoc.x, 0.0, vLoc.z), vSunL, vec3(vPit.x, vPit.y, vPit.w));
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float kS = 1.0 - 0.8 * sh * lit, ao = 0.5 + 0.5 * smoothstep(0.0, 0.10, length(vLoc.xz - vec2(0.0, vPit.y)) - vPit.x);
          reflectedLight.directDiffuse *= kS; reflectedLight.indirectDiffuse *= mix(1.0, kS, 0.5) * ao; reflectedLight.directSpecular *= 1.0 - sh; reflectedLight.indirectSpecular *= kS * ao;
        }`);
  };
  m.customProgramCacheKey = () => (PITALL ? 'A' + PDK[0] : '') + 'stTreeMound7' + (MPATH ? 'p' : WC3 ? 'w' : '') + (PIT3 ? '3' : '') + (PIT2 ? '2' : '') + (BASE2 ? 'b' : '') + (MDARK ? 'm' : '') + MK;
  return m;
}

// ---- pit geometry: local x along the kerb, z across (road at +z), y up from the sidewalk surface.
// rim: 'granite' (a low kerb in lengths) or 'cobble' (a row of setts), set low and uneven with soil in the joints; planted: ground cover.
// Per vertex aLift: 1 = lies on the soil (the shader heaps it up against the trunk), 0 = fixed, < 0 = dirt apron on the paving (-coverage).
function pitGeometry(L, Wd, seed, rim, planted, hero) {
  const R = rng(seed), P = [], C = [], I = [], LF = [], DR = [], shade = []; let lift = 1, dv = -1;
  const rimFade = (x, z) => Math.max(0, Math.min(1, (Math.min(L / 2 - 0.12 - Math.abs(x), Wd / 2 - 0.12 - Math.abs(z))) / 0.16));   // the mound never lifts soil at the rim
  const quad = (a, b, c, d, col, cols) => { const o = P.length / 3; [a, b, c, d].forEach((v, i) => { P.push(v[0], v[1], v[2]); const k = cols ? cols[i] : 1; C.push(col[0] * k, col[1] * k, col[2] * k); LF.push(v[3] !== undefined ? v[3] : lift === 1 ? rimFade(v[0], v[2]) : lift); DR.push(dv); }); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const tri = (a, b, c, col, cols) => { const o = P.length / 3; [a, b, c].forEach((v, i) => { P.push(v[0], v[1], v[2]); const k = cols ? cols[i] : 1; C.push(col[0] * k, col[1] * k, col[2] * k); LF.push(lift === 1 ? rimFade(v[0], v[2]) : lift); DR.push(dv); }); I.push(o, o + 1, o + 2); };
  const hx = L / 2, hz = Wd / 2, bw = rim === 'flush' ? 0.03 : rim === 'lip' ? 0.05 : rim === 'cobble' ? 0.11 : 0.125, rimH = rim === 'lip' ? 0.032 : rim === 'cobble' ? 0.052 : 0.06, ix = hx - bw, iz = hz - bw;
  const wet = [0.034, 0.027, 0.021], dry = PITALL ? [0.046, 0.038, 0.030] : [0.125, 0.104, 0.078], stoneC = PITALL ? [0.082, 0.082, 0.082] : [0.215, 0.212, 0.205];   // city-wide rule (Nov 13): no pale rim, no pale sandy patches: weathered grey setts, dark trodden soil
  // relief: ridges and hollows; dryness: pale sandy dirt on the high ground, black compost in the hollows and in patches
  const ph = [R() * 6.3, R() * 6.3, R() * 6.3, R() * 6.3], fq = [2.1 + R() * 2, 3.3 + R() * 3, 5 + R() * 4, 6 + R() * 5];
  const relief = (x, z) => 0.009 * Math.sin(x * fq[0] + ph[0]) * Math.cos(z * fq[1] + ph[1]) + 0.007 * Math.sin((x + z) * fq[2] + ph[2]) + 0.005 * Math.cos((x - z * 1.3) * fq[3] + ph[3]);
  const edgeD = (x, z) => Math.min(ix - Math.abs(x), iz - Math.abs(z));
  let soilY = (x, z) => 0.016 + (hero ? 0.03 : 0.014) * Math.min(1, Math.max(0, edgeD(x, z)) / (hero ? 0.45 : 0.2)) + Math.max(0, relief(x, z) + 0.004) * (hero ? 1.6 : 0.9);   // hero: mulch heaped up toward the trunk
  const wornX = (R() * 2 - 1) * ix, wornZ = (R() < 0.5 ? -1 : 1) * iz, wornR = 0.3 + 0.35 * R(), wx2 = (R() * 2 - 1) * ix * 0.7, wz2 = (R() * 2 - 1) * iz * 0.7, wr2 = 0.12 + 0.2 * R();
  const dryness = planted
    ? (x, z) => { const e = edgeD(x, z) - 0.015 - 0.05 * (0.5 + 0.5 * Math.sin(x * fq[2] + ph[1]) * Math.sin(z * fq[3] + ph[2])); return Math.max(0, Math.min(1, 0.5 - e * 6.0)); }
    : (x, z) => { const e = edgeD(x, z) - 0.06 - 0.12 * (0.5 + 0.5 * Math.sin(x * fq[2] + ph[1]) * Math.sin(z * fq[3] + ph[2])), w = Math.hypot(x - wornX, z - wornZ) - wornR, w2 = Math.hypot(x - wx2, z - wz2) - wr2; return Math.max(0, Math.min(1, 0.5 - Math.min(e, w, w2) * 4.0)); };
  const soilCol = (x, z, k) => { dv = dryness(x, z); return [k, k, k]; };   // soil is coloured in the shader from its dryness; the vertex colour is only light and dark
  { const base = soilY; soilY = (x, z) => Math.min(base(x, z) + (planted ? 0.03 : 0.014) * (1 - Math.max(0, Math.min(1, (dryness(x, z) - 0.3) / 0.4))), 0.026 + Math.max(0, edgeD(x, z)) * 0.3); }   // the mulch has thickness where it lies
  // a bed of soil under the whole pit, so the joints of the rim show dirt, not paving
  lift = 0; dv = 0.25; quad([-hx + 0.012, 0.024, -hz + 0.012], [-hx + 0.012, 0.024, hz - 0.012], [hx - 0.012, 0.024, hz - 0.012], [hx - 0.012, 0.024, -hz + 0.012], [0.6, 0.6, 0.6]); dv = -1;
  // soil surface
  lift = 1;
  const GS = hero ? 0.025 : 0.07, nx = Math.round(2 * ix / GS), nz = Math.round(2 * iz / GS), o0 = P.length / 3;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = -ix + 2 * ix * i / nx, z = -iz + 2 * iz * j / nz, border = i === 0 || j === 0 || i === nx || j === nz;
    // at the rim the soil stands at different heights against the stones
    const y = border ? 0.016 + 0.006 * R() : soilY(x, z) + (R() - 0.5) * (hero ? 0.004 : 0.006 + 0.034 * (1 - dryness(x, z))), col = soilCol(x, z, (0.8 + 0.4 * R()) * (border ? 0.7 : 1));
    // the outermost ring of the soil runs in under the stones
    const jit = hero ? 0.008 : 0.03, eo = 0.05, bx = border ? (i === 0 ? -eo : i === nx ? eo : 0) : (R() - 0.5) * jit, bz = border ? (j === 0 ? -eo : j === nz ? eo : 0) : (R() - 0.5) * jit;   // hero: a ragged edge, mulch lapping over the cut
    P.push(x + bx, y, z + bz); C.push(col[0], col[1], col[2]); LF.push(border ? 0 : rimFade(x, z)); DR.push(dv);
  }
  dv = -1;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = o0 + j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; if ((i + j) % 2) I.push(a, c, b, b, c, d); else I.push(a, c, d, a, d, b); }
  // where loose things come to rest: mostly against the rim and in the hollows
  const rest = (m) => { for (let t = 0; t < 8; t++) { let x = (R() * 2 - 1) * (ix - m), z = (R() * 2 - 1) * (iz - m); if (R() < 0.45) { if (R() < 0.5) x = Math.sign(x) * (ix - m - 0.1 * R() * R()); else z = Math.sign(z) * (iz - m - 0.1 * R() * R()); return [x, z]; } if (relief(x, z) < 0.004 || t === 7) return [x, z]; } };
  // crumbs, clods and pebbles: low rounded lumps, dark underneath
  const lump = (x, z, s, h, col) => { const y = soilY(x, z) - 0.006, n = 5 + Math.floor(R() * 2), a0 = R() * 6.283, top = [x + (R() - 0.5) * s * 0.5, y + h, z + (R() - 0.5) * s * 0.5], ring = [], mid = [];
    for (let q = 0; q < n; q++) { const a = a0 + q / n * 6.283, r2 = s * (0.75 + 0.5 * R()); ring.push([x + Math.cos(a) * r2, y, z + Math.sin(a) * r2]); mid.push([x + Math.cos(a) * r2 * 0.72, y + h * (0.6 + 0.3 * R()), z + Math.sin(a) * r2 * 0.72]); }
    for (let q = 0; q < n; q++) { const m = (q + 1) % n; quad(ring[q], mid[q], mid[m], ring[m], col, [0.35, 0.9, 0.9, 0.35]); tri(mid[q], top, mid[m], col, [0.9, 1.1, 0.9]); } };
  const nClod = hero ? 1 + Math.floor(R() * 3) : 4 + Math.floor(R() * 6);
  for (let t = 0; t < nClod; t++) { const x = (R() * 2 - 1) * (ix - 0.04), z = (R() * 2 - 1) * (iz - 0.04), s = 0.012 + 0.04 * R() * R(); const cc = soilCol(x, z, 0.9 + 0.5 * R()); lump(x, z, s, s * (0.5 + 0.4 * R()), cc); dv = -1; }
  const nPeb = 1 + Math.floor(R() * 3);
  for (let t = 0; t < nPeb; t++) { let [x, z] = rest(0.03); for (let q = 0; q < 4 && dryness(x, z) < 0.5; q++) { x = (R() * 2 - 1) * (ix - 0.03); z = (R() * 2 - 1) * (iz - 0.03); } const s = 0.005 + 0.011 * R(), k = 0.4 + 0.8 * R(), wm = R() * 0.05; lump(x, z, s, s * 0.6, [0.15 * k + wm, 0.142 * k + wm * 0.6, 0.13 * k]); }
  // loose bits that catch the light and shade the ground: bark chips on the compost, grit and stones on the bare dirt, half sunk
  { const nS = hero ? 0 : Math.round(4 * ix * iz * 170), drift = []; for (let q = 0; q < 9; q++) drift.push([(R() * 2 - 1) * ix, (R() * 2 - 1) * iz, 0.08 + 0.2 * R()]);
    for (let t = 0; t < nS; t++) {
      let x, z; if (R() < 0.65) { const dc = drift[Math.floor(R() * drift.length)], a = R() * 6.283, rr = dc[2] * Math.sqrt(R()); x = dc[0] + Math.cos(a) * rr; z = dc[1] + Math.sin(a) * rr; } else { x = (R() * 2 - 1) * ix; z = (R() * 2 - 1) * iz; }
      if (Math.abs(x) > ix - 0.03 || Math.abs(z) > iz - 0.03) continue;
      const d = dryness(x, z), y = soilY(x, z);
      if (d > 0.5) { if (R() < 0.96) continue; const s2 = 0.003 + 0.006 * R(), k = 0.4 + 0.7 * R(), wm = R() * 0.04; lump(x, z, s2, s2 * 0.6, [0.13 * k + wm, 0.12 * k + wm * 0.6, 0.11 * k]); continue; }
      const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), big = R() < 0.04, l = big ? 0.018 + 0.014 * R() : 0.004 + 0.013 * R(), w = l * (0.18 + 0.5 * R()), k = 0.35 + 0.9 * R(), up = (0.002 + 0.02 * R() * R()) * (R() < 0.5 ? 1 : -0.3), tone = R();
      const col = tone < 0.55 ? [0.06 * k, 0.036 * k, 0.025 * k] : tone < 0.85 ? [0.08 * k, 0.05 * k, 0.032 * k] : tone < 0.94 ? [0.07 * k, 0.064 * k, 0.057 * k] : [0.035 * k, 0.026 * k, 0.02 * k], jj = () => 0.6 + 0.8 * R();
      const A = [x - c * l * jj() - sn * w * jj(), y - 0.004, z - sn * l * jj() + c * w * jj()], B = [x - c * l * jj() + sn * w * jj(), y - 0.002 + up * 0.3, z - sn * l * jj() - c * w * jj()], Cc = [x + c * l * jj() + sn * w * jj(), y + Math.max(0.001, up), z + sn * l * jj() - c * w * jj()], D = [x + c * l * jj() - sn * w * jj(), y + Math.max(0.001, up * 0.6), z + sn * l * jj() + c * w * jj()];
      if (R() < 0.3) tri(A, B, Cc, col, [0.5, 0.6, 1.1]); else quad(A, B, Cc, D, col, [0.45, 0.55, 1.15, 1]);
    } }
  // mulch: bark chips and splinters, irregular, half pressed into the soil
  const nChip = 0;
  for (let t = 0; t < nChip; t++) {
    const [x, z] = R() < 0.5 ? rest(0.03) : [(R() * 2 - 1) * (ix - 0.04), (R() * 2 - 1) * (iz - 0.04)], y = soilY(x, z) + 0.002, a = R() * 6.283, c = Math.cos(a), s = Math.sin(a), l = 0.012 + 0.028 * R(), w = 0.004 + 0.009 * R(), k = 0.6 + 0.7 * R();
    const col = R() < 0.35 ? [0.105 * k, 0.098 * k, 0.088 * k] : [0.085 * k, 0.056 * k, 0.034 * k], j = () => 0.7 + 0.6 * R(), up = 0.004 + 0.012 * R();
    quad([x - c * l * j() - s * w * j(), y - 0.006, z - s * l * j() + c * w * j()], [x - c * l * j() + s * w * j(), y - 0.004, z - s * l * j() - c * w * j()], [x + c * l * j() + s * w * j(), y + up, z + s * l * j() - c * w * j()], [x + c * l * j() - s * w * j(), y + up * 0.8, z + s * l * j() + c * w * j()], col, [0.6, 0.7, 1.05, 1]);
  }
  // rim: uneven stones set low, each a little off line, grimy low down
  lift = 0;
  const block = (cx, cz, dx, dz, hl, hw, y1, col, tilt, yaw) => {   // a whole stone: flat top, rounded arrises (shared vertices, so it shades smooth), bedded level
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ax = dx * cy - dz * sy, az = dx * sy + dz * cy, px = -az, pz = ax, o = P.length / 3, bev = Math.min(0.009, hl * 0.3, hw * 0.3);
    const ring = (inset, y, k) => { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(cx + ax * (hl - inset) * a + px * (hw - inset) * b, y + a * tilt, cz + az * (hl - inset) * a + pz * (hw - inset) * b); const kk = k * (0.92 + 0.16 * R()); C.push(col[0] * kk, col[1] * kk, col[2] * kk); LF.push(0); DR.push(-1); } };
    ring(bev, y1, 1); ring(0, y1 - bev * 0.8, 0.9); ring(0, 0, 0.35);
    I.push(o, o + 3, o + 2, o, o + 2, o + 1);
    for (let r2 = 0; r2 < 2; r2++) for (let q = 0; q < 4; q++) { const n = (q + 1) % 4, a = o + r2 * 4 + q, b = o + r2 * 4 + n, c = o + r2 * 4 + 4 + n, d = o + r2 * 4 + 4 + q; I.push(a, b, c, a, c, d); }
  };
  const side = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len, px = -dz * bw / 2, pz = dx * bw / 2;
    let a = 0;
    while (a < len - 0.02) {
      const unit = rim === 'cobble' ? 0.12 + 0.14 * R() : rim === 'lip' ? 0.5 + 1.2 * R() : 0.4 + 0.9 * R(), b = Math.min(len, a + unit), gap = rim === 'cobble' ? 0.003 + 0.005 * R() : 0.002 + 0.004 * R(), m = (a + b) / 2;
      const k = rim === 'lip' ? 1.15 + 0.2 * R() : 0.5 + 0.7 * R(), warm = rim === 'cobble' ? R() * 0.05 : 0.01 * R(), col = [stoneC[0] * k + warm, stoneC[1] * k + warm * 0.7, stoneC[2] * k * 0.97], off = (R() - 0.5) * (rim === 'cobble' ? 0.012 : 0.006), sunk = 1;
      if (b - a > 0.05 && !(rim === 'cobble' && R() < 0.02)) block(x0 + dx * m + px + (-dz) * off, z0 + dz * m + pz + dx * off, dx, dz, (b - a) / 2 - gap, bw / 2 * (rim === 'cobble' ? 0.86 + 0.16 * R() : 0.8 + 0.3 * R()), rimH * (0.92 + 0.16 * R()), col, (R() - 0.5) * 0.003, (R() - 0.5) * (rim === 'cobble' ? 0.03 : 0.008));
      a = b;
    }
  };
  if (rim !== 'flush') { side(-hx, -hz, hx, -hz); side(hx, -hz, hx, hz); side(hx, hz, -hx, hz); side(-hx, hz, -hx, -hz); }   // flush: the hole is simply cut in the paving, as most Manhattan pits are
  // soil heaped over the inner edge of the rim here and there
  const nSp = 0;
  for (let t = 0; t < nSp; t++) { let x = (R() * 2 - 1) * hx, z = (R() * 2 - 1) * hz; if (R() < 0.5) x = Math.sign(x) * (ix + bw * (0.1 + 0.95 * R())); else z = Math.sign(z) * (iz + bw * (0.1 + 0.95 * R())); const s = 0.02 + 0.035 * R(), y = rimH * 0.35;
    const o = P.length / 3, n = 6, col = soilCol(x, z, 0.8 + 0.4 * R()); P.push(x, y + 0.012 + s * 0.2, z); C.push(col[0], col[1], col[2]); LF.push(0); DR.push(dv);
    for (let q = 0; q < n; q++) { const a = q / n * 6.283, r2 = s * (0.6 + 0.8 * R()); P.push(x + Math.cos(a) * r2, 0.004, z + Math.sin(a) * r2); C.push(col[0] * 0.6, col[1] * 0.6, col[2] * 0.6); LF.push(0); DR.push(dv); }
    for (let q = 0; q < n; q++) I.push(o, o + 1 + (q + 1) % n, o + 1 + q); dv = -1; }
  // plants: weeds of different kinds, sizes and health anywhere in a bare pit (thicker at the rim); a bed of ground cover in a planted one
  lift = 1;
  const blade = (ox, oz, y0, a, h, lean, w, col) => {
    const ca = Math.cos(a), sa = Math.sin(a), tx = -sa * w, tz = ca * w, tw = (R() - 0.5) * 0.5, pt = (f) => { const b2 = lean * f * f * h, aa = a + tw * f; return [ox + Math.cos(aa) * b2, y0 + h * f * (1 - 0.35 * lean * f), oz + Math.sin(aa) * b2]; };
    const p1 = pt(0.4), p2 = pt(0.75), p3 = pt(1), s1 = 0.9, s2 = 0.6;
    quad([ox - tx, y0, oz - tz], [ox + tx, y0, oz + tz], [p1[0] + tx * s1, p1[1], p1[2] + tz * s1], [p1[0] - tx * s1, p1[1], p1[2] - tz * s1], col, [0.25, 0.25, 0.7, 0.7]);
    quad([p1[0] - tx * s1, p1[1], p1[2] - tz * s1], [p1[0] + tx * s1, p1[1], p1[2] + tz * s1], [p2[0] + tx * s2, p2[1], p2[2] + tz * s2], [p2[0] - tx * s2, p2[1], p2[2] - tz * s2], col, [0.7, 0.7, 1, 1]);
    tri([p2[0] - tx * s2, p2[1], p2[2] - tz * s2], [p2[0] + tx * s2, p2[1], p2[2] + tz * s2], p3, col, [1, 1, 1.15]);
    shade.push(ox, oz);
  };
  const green = () => { const g = 0.5 + 0.8 * R(), t = R(); return t < 0.25 ? [0.15 * g, 0.13 * g, 0.055 * g] : t < 0.55 ? [0.055 * g, 0.085 * g, 0.03 * g] : t < 0.8 ? [0.035 * g, 0.075 * g, 0.026 * g] : [0.07 * g, 0.10 * g, 0.028 * g]; };
  if (planted) {
    const nC = 2 + Math.floor(R() * 3), sideX = R() < 0.5 ? -1 : 1;
    for (let cI = 0; cI < nC; cI++) {
      const ccx = sideX * ix * (0.62 + 0.3 * R()) * (R() < 0.8 ? 1 : -1), ccz = (R() * 2 - 1) * iz * 0.8, cr = 0.12 + 0.2 * R(), hC = 0.08 + 0.3 * R(), gC = 0.5 + 0.8 * R(), dryC = R() < 0.15, nT = Math.round(cr * cr * 3.14 / 0.02);
      for (let t = 0; t < nT; t++) {
        const a = R() * 6.283, rr = cr * Math.sqrt(R()), x = Math.max(-ix + 0.12, Math.min(ix - 0.12, ccx + Math.cos(a) * rr)), z = Math.max(-iz + 0.12, Math.min(iz - 0.12, ccz + Math.sin(a) * rr)); if (Math.hypot(x, z) < 0.62) continue;
        const y0 = soilY(x, z) - 0.01, g = gC * (0.8 + 0.4 * R()), nb = 6 + Math.floor(R() * 8), hgt = hC * (0.6 + 0.8 * R());
        for (let b = 0; b < nb; b++) blade(x + (R() - 0.5) * 0.05, z + (R() - 0.5) * 0.05, y0, R() * 6.283, hgt * (0.35 + 0.8 * R()), 0.25 + 0.5 * R(), 0.004 + 0.004 * R(), dryC || R() < 0.1 ? [0.15 * g, 0.13 * g, 0.06 * g] : R() < 0.3 ? [0.06 * g, 0.10 * g, 0.035 * g] : [0.028 * g, 0.068 * g, 0.024 * g]);
      }
    }
  }
  const nT = planted ? 2 : 2 + Math.floor(R() * 7);
  for (let t = 0; t < nT; t++) {
    let x = (R() * 2 - 1) * (ix - 0.02), z = (R() * 2 - 1) * (iz - 0.02); if (Math.hypot(x, z) < 0.6) continue; if (R() < 0.45) { if (R() < 0.5) x = Math.sign(x) * (ix - 0.02 - 0.1 * R()); else z = Math.sign(z) * (iz - 0.02 - 0.1 * R()); }
    const y0 = soilY(x, z) - 0.012, col = green(), kind = R();
    if (kind < 0.72) {
      const nb = 9 + Math.floor(R() * 14), hgt = 0.03 + 0.2 * R() * R(), sp = 0.02 + 0.05 * R();
      for (let b = 0; b < nb; b++) blade(x + (R() - 0.5) * sp, z + (R() - 0.5) * sp, y0, R() * 6.283, hgt * (0.5 + 0.7 * R()), 0.3 + 0.9 * R(), 0.003 + 0.005 * R(), col.map((c) => c * (0.8 + 0.4 * R())));
    } else if (kind < 0.86) {
      const nl = 5 + Math.floor(R() * 5), rad = 0.025 + 0.04 * R(), a0 = R() * 6.283;
      for (let b = 0; b < nl; b++) {
        const a = a0 + b / nl * 6.283 + (R() - 0.5) * 0.6, c = Math.cos(a), sn = Math.sin(a), l = rad * (0.6 + 0.6 * R()), w = l * (0.22 + 0.2 * R()), up = 0.01 + 0.03 * R();
        quad([x, y0 + 0.012, z], [x + c * l * 0.5 + sn * w, y0 + 0.014 + up, z + sn * l * 0.5 - c * w], [x + c * l, y0 + 0.012 + up * 0.5, z + sn * l], [x + c * l * 0.5 - sn * w, y0 + 0.014 + up, z + sn * l * 0.5 + c * w], col, [0.4, 0.9, 1.1, 0.9]);
      }
    } else {   // a taller weed: a stalk with a few leaves
      const h = 0.12 + 0.2 * R(), lx = (R() - 0.5) * 0.08, lz = (R() - 0.5) * 0.08; blade(x, z, y0, R() * 6.283, h, 0.25, 0.003, col.map((c) => c * 0.7));
      for (let b = 0; b < 5; b++) { const f = 0.3 + 0.7 * b / 5, a = R() * 6.283, l = 0.03 + 0.04 * R(), bx = x + lx * f, bz = z + lz * f, by = y0 + h * f * 0.8; tri([bx, by, bz], [bx + Math.cos(a) * l + Math.sin(a) * l * 0.3, by + 0.01, bz + Math.sin(a) * l - Math.cos(a) * l * 0.3], [bx + Math.cos(a) * l - Math.sin(a) * l * 0.3, by + 0.012, bz + Math.sin(a) * l + Math.cos(a) * l * 0.3], col, [0.6, 1, 1]); }
    }
  }
  // hero pits: fallen leaves lying on the mulch, gathered at the rim and against the trunk, green to straw to brown
  if (hero) { const nL = 8 + Math.floor(R() * 12);
    for (let t = 0; t < nL; t++) { const [x, z] = R() < 0.6 ? rest(0.03) : [(R() * 2 - 1) * (ix - 0.03), (R() * 2 - 1) * (iz - 0.03)]; if (Math.hypot(x, z) < 0.25) continue;
      const y = soilY(x, z) + 0.004, a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), l = 0.05 + 0.04 * R(), w = l * (0.7 + 0.4 * R()), tn = R(), k = 0.5 + 0.4 * R();
      const col = tn < 0.3 ? [0.17 * k, 0.14 * k, 0.07 * k] : tn < 0.7 ? [0.11 * k, 0.075 * k, 0.045 * k] : tn < 0.85 ? [0.07 * k, 0.08 * k, 0.035 * k] : [0.08 * k, 0.06 * k, 0.045 * k], cu = 0.006 * R();
      tri([x - c * l * 0.5, y, z - sn * l * 0.5], [x + c * l * 0.5 + sn * w * 0.5, y + cu, z + sn * l * 0.5 - c * w * 0.5], [x + c * l * 0.5 - sn * w * 0.5, y + cu, z + sn * l * 0.5 + c * w * 0.5], col, [0.8, 1, 1]); } }
  if (hero) { lift = 0; const nSp2 = 0;
    for (let t = 0; t < nSp2; t++) { let x = (R() * 2 - 1) * hx, z = (R() * 2 - 1) * hz; if (R() < 0.5) x = Math.sign(x) * (hx + 0.02 + 0.18 * R() * R()); else z = Math.sign(z) * (hz + 0.02 + 0.18 * R() * R());
      const a = R() * 6.283, l = 0.008 + 0.012 * R(), w = l * (0.3 + 0.4 * R()), c = Math.cos(a), sn = Math.sin(a); dv = 0.2;
      tri([x - c * l, 0.004, z - sn * l], [x + c * l + sn * w, 0.006, z + sn * l - c * w], [x + c * l - sn * w, 0.006, z + sn * l + c * w], [0.8, 0.8, 0.8], [0.7, 1, 1]); }
    dv = -1; lift = 1; }
  // what people leave: cigarette ends and scraps, lying flat, half trodden in, gathered at the edge and in the hollows
  const nB = 3 + Math.floor(R() * 9);
  for (let t = 0; t < nB; t++) {
    const [x, z] = rest(0.03), y = soilY(x, z) + 0.005, a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), l = 0.012, w = 0.0038, k = 0.6 + 0.4 * R();
    const P4 = (u0, u1, yy) => [[x + c * u0 - sn * w, yy, z + sn * u0 + c * w], [x + c * u0 + sn * w, yy, z + sn * u0 - c * w], [x + c * u1 + sn * w, yy, z + sn * u1 - c * w], [x + c * u1 - sn * w, yy, z + sn * u1 + c * w]];
    const q1 = P4(-l, 0, y), q2 = P4(0, l * (0.4 + R()), y), q3 = P4(-l, l * 1.2, y + 0.006).map((v, i) => [v[0] + (i < 2 ? 0 : 0), v[1], v[2]]);
    quad(q1[0], q1[1], q1[2], q1[3], [0.36 * k, 0.24 * k, 0.11 * k], [0.5, 0.5, 0.5, 0.5]); quad(q2[0], q2[1], q2[2], q2[3], [0.42 * k, 0.40 * k, 0.36 * k], [0.5, 0.5, 0.5, 0.5]);
    quad([q3[0][0], y + 0.007, q3[0][2]], [q3[1][0], y + 0.007, q3[1][2]], [x + sn * w, y + 0.007, z - c * w], [x - sn * w, y + 0.007, z + c * w], [0.36 * k, 0.24 * k, 0.11 * k]);
    quad([x - sn * w, y + 0.007, z + c * w], [x + sn * w, y + 0.007, z - c * w], [q2[2][0], y + 0.007, q2[2][2]], [q2[3][0], y + 0.007, q2[3][2]], [0.42 * k, 0.40 * k, 0.36 * k]);
  }
  const nLit = 0;
  for (let t = 0; t < nLit; t++) {
    const [x, z] = rest(0.1), y = soilY(x, z) + 0.004, a = R() * 6.283, sz = 0.035 + 0.05 * R(), k = R(), n = 7;
    const col = k < 0.55 ? [0.40, 0.39, 0.36] : [0.27, 0.22, 0.15], pts = [];
    for (let j = 0; j < n; j++) { const aa = a + j / n * 6.283, r2 = sz * (0.5 + 0.7 * R()); pts.push([x + Math.cos(aa) * r2, y - 0.006 + R() * 0.016, z + Math.sin(aa) * r2 * 0.7]); }
    const cen = [x, y + 0.008, z]; for (let j = 0; j < n; j++) tri(cen, pts[(j + 1) % n], pts[j], col, [0.9 + 0.2 * R(), 0.55 + 0.4 * R(), 0.55 + 0.4 * R()]);
  }
  // the soil is darker under every plant (their shadows are too fine for the shadow map)
  for (let v = o0; v < o0 + (nx + 1) * (nz + 1); v++) { let k = 1; const x = P[v * 3], z = P[v * 3 + 2];
    for (let q = 0; q < shade.length; q += 2) { const d2 = (shade[q] - x) * (shade[q] - x) + (shade[q + 1] - z) * (shade[q + 1] - z); if (d2 < 0.02) k = Math.min(k, 0.45 + 0.55 * d2 / 0.02); }
    C[v * 3] *= k; C[v * 3 + 1] *= k; C[v * 3 + 2] *= k; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aLift', new THREE.Float32BufferAttribute(LF, 1)); g.setAttribute('aDry', new THREE.Float32BufferAttribute(DR, 1)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
// dirt washed out of the pit onto the paving: a soft blended skirt (its own transparent layer), wide on the building side, a sliver at the kerb
function apronGeometry(L, Wd, seed) {
  const R = rng(seed), P = [], A = [], O = [], I = [], hx = L / 2, hz = Wd / 2;
  const ring = [], n = 48, w0 = 0.26 + 0.25 * R();
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.283, c = Math.cos(a), s = Math.sin(a), k = 1 / Math.max(Math.abs(c) / hx, Math.abs(s) / hz), ex = c * k, ez = s * k, l = Math.hypot(ex, ez);
    const w = w0 * (0.4 + 1.1 * R()) * (s > 0.3 ? 0.25 : 1), far = 2.3, zc = (z) => Math.min(z, hz + 0.06);
    ring.push([[ex * 0.9, ez * 0.9, 0.95, 0], [ex * (1 + w * 0.45 / l), zc(ez * (1 + w * 0.45 / l)), 0.45 + 0.35 * R(), 0], [ex * (1 + w / l), zc(ez * (1 + w / l)), 0, 0.15], [ex * (1 + far / l), zc(ez * (1 + far / l)), 0, 1]]);
  }
  for (const r of ring) for (const v of r) { P.push(v[0], 0.003, v[1]); A.push(v[2]); O.push(v[3]); }
  for (let i = 0; i < n; i++) { const a = i * 4, b = ((i + 1) % n) * 4; for (let q = 0; q < 3; q++) I.push(a + q, b + q, b + q + 1, a + q, b + q + 1, a + q + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aCov', new THREE.Float32BufferAttribute(A, 1)); g.setAttribute('aOut', new THREE.Float32BufferAttribute(O, 1)); g.setIndex(I); g.computeVertexNormals();
  return g;
}
function apronMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWPos; attribute float aCov; attribute float aOut; attribute vec4 aPit; varying vec2 vCov; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vPit2; uniform vec3 uSunDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCov = vec2(aCov, aOut); vLoc = position; vPit2 = vec3(aPit.x, aPit.y, aPit.w);
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz; vSunL = uSunDir * mat3(modelMatrix * instanceMatrix);
        #else
          vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vSunL = uSunDir;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec2 vCov; varying vec3 vLoc; varying vec3 vSunL; varying vec3 vPit2;\n ${COMMON_FRAG}\n ${PIT_SHADOW_GLSL}`)
      .replace('#include <color_fragment>', `
        {
          ${BAKE_READ}
          vec2 w = vWPos.xz; float c = vCov.x;
          // soil and grit tracked out of the pit: a film that thins away, with crumbs in it
          float drift = smoothstep(0.25, 0.8, fbm(w * 2.6) * 0.65 + fbm(w * 9.0) * 0.35 + (c - 0.5) * 0.7);
          diffuseColor.rgb = vec3(0.075, 0.062, 0.047) * (0.7 + 0.6 * fbm(w * 14.0)) * (0.75 + 0.5 * vnoise(w * 180.0));
          diffuseColor.a = clamp(c * c * 1.3, 0.0, 1.0) * drift * 0.8;
        }`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + `
        {
          // the trunk's and the guard's shadows run on over the paving: where the shadow map says the sun reaches, darken what lies under
          float sh = pitShadow(vLoc, vSunL, vPit2) * (1.0 - smoothstep(0.8, 1.0, vCov.y));
          float lit = smoothstep(0.12, 0.3, dot(reflectedLight.directDiffuse, vec3(0.333)) / max(dot(diffuseColor.rgb * uSunColor, vec3(0.333)), 1e-5));
          float aD = diffuseColor.a, aS = sh * lit * 0.7, aO = aD + aS * (1.0 - aD), kd = aD / max(aO, 1e-4);
          reflectedLight.directDiffuse *= kd * (1.0 - 0.95 * sh); reflectedLight.indirectDiffuse *= kd; reflectedLight.directSpecular *= 0.0; reflectedLight.indirectSpecular *= kd;
          diffuseColor.a = aO;
        }`);
  };
  m.customProgramCacheKey = () => 'stTreeApron7';
  return m;
}
// low iron guard on three sides (open to the kerb): flat-bar hoops or rails and pickets between square posts with caps and foot plates,
// every piece a little out of true
function guardGeometry(L, Wd, style, seed) {
  const R = rng(seed || 5), P = [], C = [], I = [];
  const rod = (a, b, t, t2) => {   // a bar between two points, t wide and t2 deep
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]) || 1, u = Math.abs(d[1]) / l > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let s = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]; const sl = Math.hypot(s[0], s[1], s[2]); s = s.map((v) => v / sl * t);
    let w = [d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0]]; const wl = Math.hypot(w[0], w[1], w[2]); w = w.map((v) => v / wl * (t2 || t));
    const o = P.length / 3, k = 0.8 + 0.5 * R(), col = [0.02 * k, 0.021 * k, 0.025 * k];
    for (const e of [a, b]) for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(e[0] + s[0] * p + w[0] * q, e[1] + s[1] * p + w[1] * q, e[2] + s[2] * p + w[2] * q); C.push(col[0], col[1], col[2]); }
    for (let q = 0; q < 4; q++) { const n = (q + 1) % 4; I.push(o + q, o + n, o + 4 + n, o + q, o + 4 + n, o + 4 + q); }
    I.push(o + 4, o + 5, o + 6, o + 4, o + 6, o + 7);
  };
  const hx = L / 2 - 0.06, hz = Wd / 2 - 0.06, H = 0.46, y0 = 0.06, j = (a) => (R() - 0.5) * a;
  const runs = [[-hx, -hz, hx, -hz], [-hx, -hz, -hx, hz], [hx, -hz, hx, hz]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), sag = j(0.012), lx = j(0.014), lz = j(0.014);
    const at = (f, y) => [x0 + (x1 - x0) * f + lx * y / H, y + sag * Math.sin(f * 3.1416), z0 + (z1 - z0) * f + lz * y / H];
    if (style === 'hoop') {
      rod(at(0, y0 + 0.05), at(1, y0 + 0.05), 0.004, 0.011);
      const n = Math.round(len / 0.2), w = 1.35 / n;
      for (let i = 0; i < n; i++) {
        const c = (i + 0.5) / n + j(0.004), bent = R() < 0.14 ? j(0.5) : 0, top = (H - 0.04) * (1 + j(0.04)) * (bent ? 0.93 : 1), pts = [[-0.5, 0]];
        for (let q = 0; q <= 16; q++) { const a = Math.PI * (1 - q / 16); pts.push([Math.cos(a) * 0.5, 0.6 + 0.4 * Math.sin(a)]); }
        pts.push([0.5, 0]);
        const P3 = pts.map(([u, v]) => { const q = at(Math.max(0, Math.min(1, c + u * w + bent * v * 0.06)), v === 0 ? 0.0 : y0 + v * top); q[0] += bent * v * 0.05 * (z1 - z0) / len; q[2] -= bent * v * 0.05 * (x1 - x0) / len; return q; });
        for (let k = 0; k < P3.length - 1; k++) rod(P3[k], P3[k + 1], 0.0055, 0.0075);
      }
    } else {
      for (const y of [y0 + 0.07, y0 + H]) rod(at(0, y), at(1, y), 0.005, 0.013);
      const n = Math.round(len / 0.13); for (let i = 1; i < n; i++) { const f = i / n + j(0.003); rod(at(f, y0 + 0.07), at(f, y0 + H), 0.006); }
    }
  }
  for (const [x, z] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
    const top = y0 + H + (style === 'hoop' ? -0.06 : 0.05), tx = x + j(0.016), tz = z + j(0.016), pt = 0.014;
    rod([x, 0, z], [tx, top, tz], pt); rod([tx, top, tz], [tx, top + 0.012, tz], pt * 1.5);          // post and cap
    rod([x, 0.0, z], [x, 0.008, z], 0.04);                                                              // foot plate
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  const gg = g.toNonIndexed(); gg.computeVertexNormals(); return gg;
}

// distance from each tree to the nearest building wall (metres, capped), from a grid of wall segments
function nearestEdge(polys, trees, key, cap) {
  const CS = 16, grid = new Map();
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      const x0 = Math.floor(Math.min(a[0], c[0]) / CS), x1 = Math.floor(Math.max(a[0], c[0]) / CS), y0 = Math.floor(Math.min(a[1], c[1]) / CS), y1 = Math.floor(Math.max(a[1], c[1]) / CS);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x + ',' + y; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(a[0], a[1], c[0], c[1]); }
    }
  }
  for (const t of trees) {
    let best = cap, bx = 0, by = 0; const cx = Math.floor(t.x / CS), cy = Math.floor(t.y / CS);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      const l = grid.get(x + ',' + y); if (!l) continue;
      for (let i = 0; i < l.length; i += 4) {
        const ax = l[i], ay = l[i + 1], dx = l[i + 2] - ax, dy = l[i + 3] - ay, q = Math.max(0, Math.min(1, ((t.x - ax) * dx + (t.y - ay) * dy) / (dx * dx + dy * dy + 1e-9)));
        const d = Math.hypot(t.x - ax - dx * q, t.y - ay - dy * q); if (d < best) { best = d; bx = ax + dx * q - t.x; by = ay + dy * q - t.y; }
      }
    }
    t[key] = best; t[key + 'v'] = [bx, by];
  }
}
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }

// The foot of a near tree is scanned geometry: the lowest part of a real trunk (Poly Haven scans, cut and straightened by
// tools in the lane's scratch; assets/streets/trees/feet.json) stood around the generated trunk, following its axis, never inside it,
// its far-flung roots drawn in; it wears the species' own bark (same material, UVs continued from the trunk) so there is no seam.
function footGeometry(foot, T, S, seed) {
  const flareK = S.bark === 3 ? 1.25 : 1;   // the census trees: a fuller root collar
  const SINK = S.trunkR < 0.2 ? 0.05 : 0.10, suv = new Float32Array(Uint8Array.from(atob(foot.uv), (c) => c.charCodeAt(0)).buffer);
  const f32 = new Float32Array(Uint8Array.from(atob(foot.pos), (c) => c.charCodeAt(0)).buffer), u16 = new Uint16Array(Uint8Array.from(atob(foot.idx), (c) => c.charCodeAt(0)).buffer);
  const tp = T.info.trunk.pts, tr = T.info.trunk.rad;
  const at = (y) => { let i = 0; while (i < tp.length - 2 && tp[i + 1][1] < y) i++; const a = tp[i], b = tp[i + 1], t = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1] || 1))); return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t, tr[i] + (tr[i + 1] - tr[i]) * t]; };
  const k = at(foot.h * S.trunkR)[2], ang = seed * 2.399, ca = Math.cos(ang), sa = Math.sin(ang), urep = Math.max(1, Math.round(6.283 * S.trunkR / 0.45));
  const n = f32.length / 3, P = new Float32Array(n * 3), A = new Float32Array(n), Rr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let x = f32[i * 3] * ca - f32[i * 3 + 2] * sa, z = f32[i * 3] * sa + f32[i * 3 + 2] * ca; const y = f32[i * 3 + 1] * k - SINK, c = at(y);
    let r = Math.hypot(x, z) || 1e-6; const r2 = (r < 1.6 ? r : 1.6 + (r - 1.6) * 0.4) ; x *= r2 / r; z *= r2 / r; r = r2;
    const rw = Math.max(r * k * (flareK || 1), c[2] * 1.012);                                   // never inside the generated trunk
    x = x / r * rw; z = z / r * rw;
    P[i * 3] = c[0] + x; P[i * 3 + 1] = y; P[i * 3 + 2] = c[1] + z; A[i] = Math.atan2(-x, -z); if (A[i] < 0) A[i] += 6.283185; Rr[i] = rw - c[2];
  }
  const pos = [], uv = [], aw = [], uv2 = [], top = foot.h * k - SINK;
  const push = (i, a) => { pos.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); uv.push(a / 6.283185 * urep, (P[i * 3 + 1] + 0.35) / 0.55 + Math.max(0, Rr[i]) / 0.55 * 0.8); const e = Math.max(0, Math.min(1, (P[i * 3 + 1] - (top - 0.42)) / 0.38)); aw.push(255, 255, Math.round(255 * (1 - e * e * (3 - 2 * e))), 255); uv2.push(suv[i * 2], suv[i * 2 + 1]); };
  for (let t = 0; t < u16.length; t += 3) {
    const v = [u16[t], u16[t + 1], u16[t + 2]], a = v.map((i) => A[i]), wrap = Math.max(...a) - Math.min(...a) > Math.PI;
    for (let q = 0; q < 3; q++) push(v[q], wrap && a[q] < Math.PI ? a[q] + 6.283185 : a[q]);
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aW', new THREE.BufferAttribute(new Uint8Array(aw), 4, true)); g.setAttribute('aUv2', new THREE.Float32BufferAttribute(uv2, 2));
  // smooth normals by position (the triangles were split so the bark's u can wrap)
  const key = (i) => Math.round(pos[i * 3] * 2000) + ',' + Math.round(pos[i * 3 + 1] * 2000) + ',' + Math.round(pos[i * 3 + 2] * 2000), acc = new Map(), nrm = new Float32Array(pos.length);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  for (let t = 0; t < pos.length / 9; t++) { pa.fromArray(pos, t * 9); pb.fromArray(pos, t * 9 + 3); pc.fromArray(pos, t * 9 + 6); nn.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa));
    for (let q = 0; q < 3; q++) { const kk = key(t * 3 + q); let o = acc.get(kk); if (!o) acc.set(kk, o = new THREE.Vector3()); o.add(nn); } }
  // scans are not always wound the same way round: make the normals point away from the trunk axis
  let outw = 0; for (let i = 0; i < pos.length / 3; i++) { const o = acc.get(key(i)), c = at(pos[i * 3 + 1]); outw += o.x * (pos[i * 3] - c[0]) + o.z * (pos[i * 3 + 2] - c[1]); }
  const sgn = outw < 0 ? -1 : 1;
  for (let i = 0; i < pos.length / 3; i++) { const o = acc.get(key(i)), c = at(pos[i * 3 + 1]); nn.copy(o).multiplyScalar(sgn); const rx = pos[i * 3] - c[0], rz = pos[i * 3 + 2] - c[1];
    if (nn.lengthSq() < 1e-14 || nn.x * rx + nn.z * rz < -0.2 * Math.hypot(rx, rz) * nn.length()) nn.set(rx, 0.3 * Math.hypot(rx, rz), rz);   // a collapsed or turned patch of the scan: face it outward
    nn.normalize(); nrm[i * 3] = nn.x; nrm[i * 3 + 1] = nn.y; nrm[i * 3 + 2] = nn.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (sgn < 0) { const p2 = g.attributes.position.array, u2 = g.attributes.uv.array; for (let t = 0; t < pos.length / 9; t++) { for (let c = 0; c < 3; c++) { const a = t * 9 + 3 + c, b = t * 9 + 6 + c, tmp = p2[a]; p2[a] = p2[b]; p2[b] = tmp; const na = nrm[a]; nrm[a] = nrm[b]; nrm[b] = na; } for (let c = 0; c < 2; c++) { const a = t * 6 + 2 + c, b = t * 6 + 4 + c, tmp = u2[a]; u2[a] = u2[b]; u2[b] = tmp; const u3 = g.attributes.aUv2.array, t3 = u3[a]; u3[a] = u3[b]; u3[b] = t3; } const wa = g.attributes.aW.array, a4 = t * 12 + 4 + 2, b4 = t * 12 + 8 + 2, tw = wa[a4]; wa[a4] = wa[b4]; wa[b4] = tw; } }
  // the narrowest the bark gets near the soil line, for the pit's mound
  const bins = new Array(16).fill(0); for (let i = 0; i < n; i++) if (P[i * 3 + 1] > 0.04 && P[i * 3 + 1] < 0.16) { const b = Math.floor(A[i] / 6.2832 * 16) % 16; bins[b] = Math.max(bins[b], Rr[i] + at(P[i * 3 + 1])[2]); }
  const nz = bins.filter((b) => b > 0);
  // the soil is heaped to a radius between the narrowest and the widest of the foot at the soil line: it buries the undersides of the lobes and banks up on the slim sides
  const lo = nz.length ? Math.min(...nz) : k * 1.05, hi = nz.length ? Math.max(...nz) : k * 1.05;
  return { g, rMin: lo + 0.6 * (hi - lo), tris: pos.length / 9 };
}

// Far crowns are impostors baked at load from the models' own leaves: for each model, eight views round the crown, each a cell of
// two atlases: (brightness, yellowing, occlusion | coverage) and the leaves' shading normal in the model's frame. The impostor is
// then lit like the leaves themselves (sun side and shade side, back-lit glow, tint and yellowing per tree), not painted.
const IMP_VIEWS = 8, IMP_CELL = 224;
function bakeImpostors(renderer, models) {
  const W = IMP_CELL * IMP_VIEWS, H = IMP_CELL * models.length;
  const mk = () => new THREE.WebGLRenderTarget(W, H, { samples: 4, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
  const rtA = mk(), rtN = mk();
  const vs = 'attribute vec4 aLeaf; varying vec4 vL; varying vec3 vN; varying vec2 vU; void main(){ vL = aLeaf; vN = normal; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const cut = 'uniform sampler2D tC; uniform float uCard; varying vec2 vU;', cutM = 'if (uCard > 0.5 && texture2D(tC, vU).a < 0.36) discard;', cu = () => ({ tC: { value: null }, uCard: { value: 0 } });
  const matA = new THREE.ShaderMaterial({ uniforms: cu(), vertexShader: vs, fragmentShader: cut + 'varying vec4 vL; varying vec3 vN; void main(){ ' + cutM + ' gl_FragColor = vec4(vL.rgb, 1.0); }', side: THREE.DoubleSide });
  const matN = new THREE.ShaderMaterial({ uniforms: cu(), vertexShader: vs, fragmentShader: cut + 'varying vec4 vL; varying vec3 vN; void main(){ ' + cutM + ' gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0); }', side: THREE.DoubleSide });
  const scene = new THREE.Scene(), mesh = new THREE.Mesh(models[0].lods[1].lg, matA), cam = new THREE.OrthographicCamera(); mesh.frustumCulled = false; scene.add(mesh);
  const old = { rt: renderer.getRenderTarget(), col: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha(), auto: renderer.autoClear };
  renderer.autoClear = false; renderer.setClearColor(0x000000, 0);
  for (const [rt, mat] of [[rtA, matA], [rtN, matN]]) {
    mesh.material = mat; rt.scissorTest = false; rt.viewport.set(0, 0, W, H); renderer.setRenderTarget(rt); renderer.clear(true, true, true);
    models.forEach((m, row) => {
      mesh.geometry = m.impLg || m.lods[1].lg; const I = m.imp, yc = (I.y0 + I.y1) / 2; mat.uniforms.tC.value = m.spray ? m.spray.c : null; mat.uniforms.uCard.value = m.spray ? 1 : 0; mat.uniformsNeedUpdate = true;
      for (let k = 0; k < IMP_VIEWS; k++) {
        const a = k * 2 * Math.PI / IMP_VIEWS;
        cam.left = -I.R; cam.right = I.R; cam.bottom = I.y0 - yc; cam.top = I.y1 - yc; cam.near = 0.1; cam.far = I.R * 6; cam.position.set(Math.sin(a) * I.R * 3, yc, Math.cos(a) * I.R * 3); cam.up.set(0, 1, 0); cam.lookAt(0, yc, 0); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        rt.viewport.set(k * IMP_CELL, row * IMP_CELL, IMP_CELL, IMP_CELL); rt.scissor.set(k * IMP_CELL, row * IMP_CELL, IMP_CELL, IMP_CELL); rt.scissorTest = true; renderer.setRenderTarget(rt); renderer.render(scene, cam);
      }
    });
  }
  renderer.setRenderTarget(old.rt); renderer.setClearColor(old.col, old.a); renderer.autoClear = old.auto; matA.dispose(); matN.dispose();
  return { a: rtA.texture, n: rtN.texture, rows: models.length };
}

// Load time (Nov 12): the 19 generated tree models took about 2 s of the page's main thread at load (release helper: trees 2435 ms).
// They are now made in a few workers side by side while the textures and the scan load; the same code and seeds, so the same trees.
// Any failure (no module workers, a worker error, 20 s without an answer) falls back to making them on the main thread as before. ?genw=0 = before.
// Nov 12 (download): the game fetches the trimmed set in assets/streets/trees/ (tools/trees_pack.py: 1K sets, packed meshes); ?treesfull=1 reads the
// master files from assets/streets/trees_full/ when that folder is laid in for a before/after sitting (it is not part of a release)
const FULL = typeof location !== 'undefined' && /[?&]treesfull=1/.test(location.search), TDIR = FULL ? 'trees_full/' : 'trees/';
// a packed mesh file (json.pack = { n, ops }): gzip of the sections in file order, each as raw bytes, byte planes, delta-coded words, floats in 16 bits
// between their lowest and highest value, or unit quaternions in 8 bits; this rebuilds the original byte layout, so the readers below are unchanged
async function unpackBin(url, pack) {
  const r = await fetch(url); if (!r.ok) throw new Error('trees: ' + url + ' ' + r.status);
  const src = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()), out = new Uint8Array(pack.n); let p = 0;
  for (const op of pack.ops) { const k = op[0], off = op[1], nb = op[2];
    if (k === 'raw') { out.set(src.subarray(p, p + nb), off); p += nb; }
    else if (k === 'q8') { const n = nb / 2, o = new Int16Array(out.buffer, off, n); for (let i = 0; i < n; i++) o[i] = Math.round((src[p + i] << 24 >> 24) * 32767 / 127); p += n; }
    else if (k === 'n4') { const n = nb / 2; for (let i = 0; i < n; i++) { const b = src[p + i]; out[off + i * 2] = (b & 15) * 17; out[off + i * 2 + 1] = (b >> 4) * 17; } p += n; }
    else if (k === 'f16') { const c = op[3], dl = op[4], lo = op[5], hi = op[6], m = (1 << (op[7] || 16)) - 1, n = nb / 4, q = new Uint16Array(n), f = new Float32Array(out.buffer, off, n);
      for (let i = 0; i < n; i++) q[i] = src[p + i] | (src[p + n + i] << 8); p += n * 2; if (dl) for (let i = c; i < n; i++) q[i] += q[i - c];
      for (let i = 0; i < n; i++) { const j = i % c; f[i] = lo[j] + q[i] / m * (hi[j] - lo[j]); } }
    else { const w = +k[1], n = nb / w, c = op[3] || 1; for (let j = 0; j < w; j++) for (let i = 0; i < n; i++) out[off + i * w + j] = src[p + j * n + i]; p += nb;
      if (k[0] === 'd') { const a = w === 1 ? new Uint8Array(out.buffer, off, n) : w === 2 ? new Uint16Array(out.buffer, off, n) : new Uint32Array(out.buffer, off, n); for (let i = c; i < n; i++) a[i] += a[i - c]; } } }
  if (p !== src.length) throw new Error('trees: ' + url + ' unpacked ' + p + ' of ' + src.length);
  return out.buffer; }
const SUNVIS = typeof location !== 'undefined' && /[?&]sunvis=1/.test(location.search);   // round 34: the cut-out crown (4.6-44 m) takes the sun leaf by leaf: whether the sun reaches each piece through the crown is worked out at load for eight compass directions (a march through the crown's own leaf density), as the near band's baked values are; before, an ellipsoid stood in for the crown
const GENW = typeof location === 'undefined' || !/[?&]genw=0/.test(location.search);
function genInWorkers(jobs, init) {
  const src = `import { makeTree, SPECIES } from ${JSON.stringify(new URL('./trees_gen_next.js', import.meta.url).href)};
    let opt = null; const keep = new Set();
    onmessage = (e) => { const d = e.data;
      if (d.init) { let boughs = null; if (d.boughs) { boughs = {}; for (const slug in d.boughs) { const meta = d.boughs[slug].meta, buf = d.boughs[slug].buf; keep.add(buf); const f32 = (o) => new Float32Array(buf, o[0], o[1]), u32 = (o) => new Uint32Array(buf, o[0], o[1]);
          boughs[slug] = { list: meta.boughs.map((b) => ({ r0: b.r0, wP: f32(b.wP), wN: f32(b.wN), wUV: f32(b.wUV), wI: u32(b.wI), lP: f32(b.lP), lN: f32(b.lN), lUV: f32(b.lUV), lI: u32(b.lI), lF: u32(b.lF), cen: f32(b.cen) })) }; } }
        opt = { sprays: d.sprays, flare: d.flare, boughs, trunk2: d.trunk2 }; return; }
      const T = makeTree(SPECIES[d.sp], d.seed, opt), tr = new Set();
      const walk = (o, dep) => { if (!o || dep > 4) return; if (ArrayBuffer.isView(o)) { if (!keep.has(o.buffer)) tr.add(o.buffer); return; } if (typeof o === 'object' && !Array.isArray(o)) for (const k in o) walk(o[k], dep + 1); else if (Array.isArray(o) && o.length < 8) for (const v of o) walk(v, dep + 1); };
      walk(T, 0); postMessage({ id: d.id, T }, [...tr]); };`;
  return new Promise((resolve) => {
    const out = new Array(jobs.length).fill(null), ws = []; let left = jobs.length, next = 0, done = false, url = null;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); for (const w of ws) try { w.terminate(); } catch (e) {} if (url) URL.revokeObjectURL(url); resolve(out); };
    const timer = setTimeout(finish, 20000);
    try {
      url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const order = jobs.map((j, i) => i).sort((a, b) => jobs[b].w - jobs[a].w), n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2, jobs.length));
      for (let k = 0; k < n; k++) { const w = new Worker(url, { type: 'module' }); ws.push(w);
        const give = () => { if (next < order.length) { const i = order[next++]; w.postMessage({ id: i, sp: jobs[i].sp, seed: jobs[i].seed }); } };
        w.onmessage = (e) => { out[e.data.id] = e.data.T; if (--left === 0) finish(); else give(); };
        w.onerror = w.onmessageerror = (e) => { console.warn('[trees] model worker failed, the rest is made on the main thread', e && e.message); if (e && e.preventDefault) e.preventDefault(); finish(); };
        w.postMessage(Object.assign({ init: 1 }, init)); give(); }
    } catch (e) { console.warn('[trees] no model workers', e); finish(); }
  });
}

// ?tcnt=1 (Nov 12, measuring): every 6 s one short page error saying what the trees part draws (meshes / instances / thousand triangles, by kind;
// shadow casters apart) and the frame's draw calls, so two builds can be compared at one camera. ?treeslead=1 (lane only) loads the measuring copy of
// the lead's Nov 9 module (trees_lead.js) in place of this one.
function treeCount(game) { const world = game.world || window.world; setInterval(() => { try { const g = game, w = world; if (!g.fly || !g.streets || !g.streets.parts.trees) return;
  const grp = g.streets.parts.trees.group, M = {}, C = {}; let allCast = 0, allCastT = 0;
  const tr = (o) => { const ge = o.geometry, ic = ge.index ? ge.index.count : ge.attributes.position.count, n = o.isInstancedMesh ? o.count : (ge.isInstancedBufferGeometry ? ge.instanceCount : 1); return [n, Math.min(ic, ge.drawRange.count) / 3 * n]; };
  grp.traverseVisible((o) => { if (!o.isMesh) return; const [n, t] = tr(o); if (!n) return; const k = (o.userData.kind || '?').replace('st_tree', '') || 'tree', T = o.castShadow ? C : M; T[k] = T[k] || [0, 0, 0]; T[k][0]++; T[k][1] += n; T[k][2] += Math.round(t / 1000); });
  w.scene.traverseVisible((o) => { if (o.isMesh && o.castShadow) { const [n, t] = tr(o); if (n) { allCast++; allCastT += t; } } });
  let L = ''; w.scene.traverse((o) => { if (o.isLight && o.castShadow) L += o.shadow.mapSize.x + ' '; });
  const f = g.fly, r = w.renderer.info.render, s = (T) => Object.keys(T).map((k) => k + ':' + T[k].join('/')).join(' ');
  const msg = 'TCNT ' + Math.round(f.x) + ',' + Math.round(f.y) + ' calls ' + r.calls + ' kt ' + Math.round(r.triangles / 1000) + ' shm ' + (w.renderer.shadowMap.enabled ? L : 'off ') + '| plain ' + s(M) + ' | CAST ' + s(C) + ' | allcast ' + allCast + ' kt ' + Math.round(allCastT / 1000) + ' | ' + Object.keys(g.streets.report).map((k) => k.slice(0, 2) + (typeof g.streets.report[k] === 'string' ? '!' : '')).join('');
  setTimeout(() => { throw new Error(msg.slice(0, 285)); }, 0); } catch (e) { setTimeout(() => { throw new Error('TCNT failed ' + e.message); }, 0); } }, 6000); }
export async function add(game, ctx) {
  if (/[?&]tcnt=1/.test(location.search)) treeCount(game);
  if (/[?&]treeslead=1/.test(location.search)) { let lead = null; try { lead = await import('./trees_lead.js'); } catch (e) { console.warn('[trees] ?treeslead=1: the measuring copy is not in this build'); } if (lead) return lead.add(game, ctx); }
  const world = game.world, shared = world.shared, scene = world.scene;
  const group = new THREE.Group(); group.name = 'streets_trees'; scene.add(group);
  // ?shdbg=1 (Nov 12): say WHICH material a 'Shader Error' line belongs to (three prints only the first line into the capture logs): one console
  // line per failing program with its name, type, own uniforms and the compiler's words; also thrown, so the pod's log shows it as a pageerror
  if (/[?&]shdbg=1/.test(location.search) && !world.renderer.debug.__shdbg) { const r = world.renderer, seenP = new Set(); r.debug.__shdbg = window.__shdbg = [];
    r.debug.onShaderError = (gl, prog, vs, fs) => { if (seenP.has(prog)) return; seenP.add(prog);
      const P = (r.info.programs || []).find((p) => p.program === prog) || {}, src = (gl.getShaderSource(fs) || '') + (gl.getShaderSource(vs) || '');
      const own = [...new Set((src.match(/uniform\s+\w+\s+\w+/g) || []).map((u) => u.split(/\s+/)[2]).filter((u) => !/^(modelMatrix|modelViewMatrix|projectionMatrix|viewMatrix|normalMatrix|cameraPosition|isOrthographic|diffuse|emissive|roughness|metalness|opacity|envMap\w*|flipEnvMap|backgroundBlurriness|receiveShadow|ambientLightColor|lightProbe|directional\w+|spot\w+|point\w+|hemisphere\w+|rectAreaLights|ltc_\d|fog\w+|toneMappingExposure|map|normalMap|normalScale|alphaTest|\w+Transform|shadowMap\w*)$/.test(u)))].slice(0, 14).join(',');
      const el = (t) => ((t || '').match(/ERROR[^\n]*/g) || []).slice(0, 2).join(' / ');
      const line = 'Shader Error detail: name=' + (P.name || '?') + ' type=' + (P.type || '?') + ' glerr=' + gl.getError() + ' lost=' + gl.isContextLost() + ' fsLen=' + (gl.getShaderSource(fs) || '').length + ' own=[' + own + '] program=' + (gl.getProgramInfoLog(prog) || '').trim().slice(0, 160).replace(/\n/g, ' ') + ' vs=' + el(gl.getShaderInfoLog(vs)) + ' fs=' + el(gl.getShaderInfoLog(fs));
      window.__shdbg.push(line); console.error(line); setTimeout(() => { throw new Error(line); }, 0); };
    setTimeout(() => { let rep = ''; try { const R = window.game.streets.report, o = {}; for (const k in R) o[k] = typeof R[k] === 'string' ? R[k].slice(0, 60) : R[k].ms; rep = ' | trees ' + R.trees.ms + ' tm ' + JSON.stringify(R.trees.tm).replace(/"/g, '') + ' cores ' + navigator.hardwareConcurrency + ' | parts ' + JSON.stringify(o).replace(/"/g, ''); } catch (e) {} try { const es = performance.getEntriesByType('resource').filter((e) => /assets\/streets\/trees\//.test(e.name)); rep = ' | fetched ' + es.length + ' tree files ' + es.reduce((q, e) => q + (e.encodedBodySize || 0), 0) + ' bytes' + (/[?&]shfiles=1/.test(location.search) ? ' [' + es.map((e) => e.name.replace(/^.*\/trees(_full)?\//, '$1/') + ':' + e.encodedBodySize).join(' ') + ']' : '') + rep; } catch (e) {} const m = 'shdbg errors ' + window.__shdbg.length + ' of ' + (r.info.programs || []).length + rep; console.error(m); throw new Error(m); }, 25000); }
  // measuring switches (round 28): ?tao=0 turns the game's AO pass off at load (pin it with ao=1 so the governor leaves it), ?treesoff=1 leaves the lead's trees as they are
  if (/[?&]tao=0/.test(location.search) && world.gtao) world.gtao.enabled = false;
  if (/[?&]treesoff=1/.test(location.search)) return { group, report: { instances: 0, off: 1 } };

  const TM0 = performance.now(), tm = {}; let TMl = TM0; const mark = (k) => { const n = performance.now(); tm[k] = Math.round(n - TMl); TMl = n; };   // where the load time goes (report.tm, ms)
  // ---- the trees the lead placed
  const seen = new Set(), trees = [];
  for (const im of game.propMeshes || []) {
    const kind = im.userData.kind; if (kind !== 'tree' && kind !== 'tree2') continue;
    im.visible = false;
    const items = im.userData.items; if (!items || seen.has(items)) continue; seen.add(items);
    for (const p of items) trees.push({ x: p[0], y: p[1], h: p[2], s: kind === 'tree2' ? (p[3] || 1) / 0.7 : (p[3] || 1), park: kind === 'tree2' });
  }
  if (!trees.length) return { group, report: { instances: 0 } };
  // a tree standing in a park is a park tree whatever its size; the others are street trees: find their wall and their kerb
  const parks = (ctx.city.parks || []).map((p) => p.ext).filter(Boolean);
  for (const t of trees) if (!t.park) for (const p of parks) if (inPoly(t.x, t.y, p)) { t.park = true; break; }
  // hero blocks: the lead's street trees there give way to the trees that really stand there (2015 census: species, trunk size, guard)
  let nHero = 0, nDropped = 0;
  try {
    const hc = await (await fetch(ctx.A + TDIR + 'hero_census.json')).json(), B = HERO_BOX, inBox = (t) => t.x > B[0] && t.x < B[2] && t.y > B[1] && t.y < B[3];
    const cs = game.statics && game.statics.circ;
    for (let i = trees.length - 1; i >= 0; i--) { const t = trees[i]; if (t.park || !inBox(t)) continue;
      if (cs) { const a = cs.get(game.statics.key(Math.floor(t.x / game.statics.cell), Math.floor(t.y / game.statics.cell))); if (a) for (const o of a) if (o.tag === 'tree' && o.on && Math.abs(o.x - t.x) < 0.02 && Math.abs(o.y - t.y) < 0.02) o.on = false; }
      trees.splice(i, 1); nDropped++; }
    const blocks = ctx.city.blocks.map((b) => b.ext);
    const kq = hc.trees.map((c) => ({ x: c[0], y: c[1] })); nearestEdge(blocks, kq, 'kerb', 30);
    hc.trees.forEach((c, i) => {
      let x = c[0], y = c[1]; const q = kq[i];
      // the census point is the kerb-side edge of the pit; where it falls just off the paving (survey vs map), it is drawn back onto the sidewalk
      if (q.kerb < 1.5 && !blocks.some((b) => inPoly(x, y, b))) { const l = Math.hypot(q.kerbv[0], q.kerbv[1]) || 1; x += q.kerbv[0] / l * (q.kerb + 0.8); y += q.kerbv[1] / l * (q.kerb + 0.8); }
      trees.push({ x, y, h: 0, s: 1, park: false, hero: { sp: c[2], dbh: c[3], guard: !!c[4], id: c[5] } }); nHero++;
      if (game.statics && game.statics.addCircle) game.statics.addCircle(x, y, 0.25, 'tree');
    });
  } catch (e) { console.warn('[trees] hero census not loaded', e); }
  nearestEdge(ctx.city.buildings.filter((b) => !b.far && (b.minh || 0) < 5).map((b) => b.poly), trees, 'wall', 12);
  nearestEdge(ctx.city.blocks.map((b) => b.ext), trees, 'kerb', 12);
  nearestEdge(parks, trees, 'pk', 12);          // a street tree at a park's edge: look at what it stands on; on grass it gets no pit
  { const grass = []; if (world.cityRoot) world.cityRoot.traverse((o) => { if (o.isMesh && /^grass/.test(o.name)) grass.push(o); });
    const rc = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
    for (const t of trees) if (!t.park && t.pk < 2.4 && grass.length) { from.set(t.x, 60, -t.y); rc.set(from, dn); t.onGrass = rc.intersectObjects(grass, false).length > 0;
      // hard against the grass there is no room for a pit on the paving: the tree stands just inside the lawn instead
      if (!t.onGrass && t.pk < 0.7) { const l = Math.hypot(t.pkv[0], t.pkv[1]) || 1; t.from = [t.x, t.y]; t.x += t.pkv[0] / l * (t.pk + 0.7); t.y += t.pkv[1] / l * (t.pk + 0.7); t.onGrass = true; } } }
  // Nov 12 (trees out of the lanes): no trunk stands in a roadway. Every tree is tested against every road: inside a travel lane (the whole
  // edge, ends included: roads.inLane skips the first and last 0.5 m), or off the sidewalk and between the kerbs, or off the sidewalk and inside a
  // junction's circle. Such a tree is moved straight out onto the sidewalk (or lawn) beside the road when that is under 3.5 m away and free;
  // otherwise it is not drawn. Its collision circle goes with it. ?lanefix=0 = before; ?lanechk=1 prints the list as a page error line.
  let laneFix = null;
  if (game.roads && game.roads.edges && !/[?&]lanefix=0/.test(location.search)) { try {
    const R = game.roads, St = game.statics, moved = [], dropped = [], blds = ctx.city.buildings.filter((b) => !b.far && (b.minh || 0) < 5);
    for (const e of R.edges) if (!e.box) e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
    const onSw = (x, y) => !!(St && St.onSidewalk && St.onSidewalk(x, y));
    const test = (x, y, r) => { let worst = null; const sw = onSw(x, y);
      for (const e of R.edges) { const b = e.box, hw = Math.max(e.width || 0, e.lanes * e.lw) / 2 + r + 0.3; if (x < b[0] - hw || x > b[2] + hw || y < b[1] - hw || y > b[3] + hw) continue;
        const pr = e.line.project(x, y), lane = pr.d - (e.lanes * e.lw) / 2 - r, kerb = pr.d - (e.width || 0) / 2 - r;
        if (lane < 0.3 || (!sw && kerb < 0)) { const need = Math.max(0.3 - lane, sw ? 0 : -kerb); if (!worst || need > worst.need) worst = { need, pr, e, why: lane < 0 ? 'lane' : lane < 0.3 ? 'lane edge' : 'roadway' }; } }
      if (!sw && !worst) for (const n of R.nodes) if (Math.hypot(x - n.p[0], y - n.p[1]) < (n.r || 0) + r) { worst = { need: 9, why: 'junction' }; break; }
      return worst; };
    const circAt = (x, y) => { const a = St && St.circ && St.circ.get(St.key(Math.floor(x / St.cell), Math.floor(y / St.cell))); if (a) for (const o of a) if (o.tag === 'tree' && o.on && Math.abs(o.x - x) < 0.02 && Math.abs(o.y - y) < 0.02) return o; return null; };
    for (let i = trees.length - 1; i >= 0; i--) { const t = trees[i], w = test(t.x, t.y, 0.25); if (!w) continue;
      let ok = false, nx = 0, ny = 0;
      if (w.pr && w.need + 0.8 <= 3.5) { let ux = t.x - w.pr.x, uy = t.y - w.pr.y; const l = Math.hypot(ux, uy);
        if (l > 0.02) { ux /= l; uy /= l; const d = (w.e.width || w.e.lanes * w.e.lw) / 2 + 0.25 + 0.8; nx = w.pr.x + ux * Math.max(d, l + 0.3); ny = w.pr.y + uy * Math.max(d, l + 0.3);
          ok = !test(nx, ny, 0.25) && (onSw(nx, ny) || parks.some((p) => inPoly(nx, ny, p))) && !blds.some((b) => inPoly(nx, ny, b.poly)) && !trees.some((o) => o !== t && Math.hypot(o.x - nx, o.y - ny) < 3); } }
      const rec = [+t.x.toFixed(2), +t.y.toFixed(2), 0.25, w.why, t.hero ? 'census' : t.park ? 'park' : 'street'];
      if (ok) { if (t.hero) { const c1 = circAt(t.x, t.y); if (c1) c1.on = false; if (St && St.addCircle) St.addCircle(nx, ny, 0.25, 'tree'); }   // a census tree's circle is moved here; the others' where trees moved off the paving get theirs (t.from, below)
        if (!t.from) t.from = [t.x, t.y];
        t.x = nx; t.y = ny; rec.push('moved to', +nx.toFixed(2), +ny.toFixed(2)); moved.push(rec); nearestEdge(blds.map((b) => b.poly), [t], 'wall', 12); nearestEdge(ctx.city.blocks.map((b) => b.ext), [t], 'kerb', 12); nearestEdge(parks, [t], 'pk', 12); }
      else { const c0 = circAt(t.x, t.y) || (t.from && circAt(t.from[0], t.from[1])); if (c0) c0.on = false; trees.splice(i, 1); rec.push('dropped'); dropped.push(rec); } }
    laneFix = { moved, dropped }; window.__treesLaneFix = laneFix;
    if (moved.length || dropped.length) console.log('[trees] out of the lanes: moved ' + moved.length + ', dropped ' + dropped.length);
    if (/[?&]lanechk=1/.test(location.search)) { let left = 0; for (const t of trees) if (test(t.x, t.y, 0.25)) left++; let cl = 0, ca = 0; if (St && St.circ) for (const a of St.circ.values()) for (const o of a) if (o.tag === 'tree' && o.on !== false) { ca++; if (R.inLane(o.x, o.y, 0)) cl++; }
      const line = 'LANECHK trees ' + trees.length + ' still failing ' + left + ' | tree circles now ' + ca + ' inLane ' + cl + ' (the circles of trees moved here are added further down) | ' + 'moved ' + moved.length + ' dropped ' + dropped.length; setTimeout(() => { throw new Error(line); }, 0);
      setTimeout(() => { let n = 0, a2 = 0; for (const a of St.circ.values()) for (const o of a) if (o.tag === 'tree' && o.on !== false) { a2++; if (test(o.x, o.y, o.r)) n++; } setTimeout(() => { throw new Error('LANECIRC live tree circles failing the test ' + n + ' of ' + a2); }, 0); }, 15000);
      moved.concat(dropped).forEach((q, i) => setTimeout(() => { throw new Error('LANEFIX ' + (i + 1) + ' ' + q.join(',')); }, 0)); }
  } catch (e) { console.warn('[trees] lane fix failed', e); } }
  for (const t of trees) if (!t.park) { const v = t.kerbv, l = Math.hypot(v[0], v[1]); t.kh = l > 0.05 && t.kerb < 6 ? Math.atan2(v[0], -v[1]) : t.h; }

  mark('place');
  // ---- models
  // the generated models start in workers now (see genInWorkers); they are collected where the models are put together
  const genJobs = []; { let vi0 = 0; for (const [sp, n] of VARIANTS) for (let k = 0; k < n; k++) { genJobs.push({ sp, seed: 101 + vi0 * 37 + k * 11, w: SPECIES[sp].bough ? 3 : (sp === 'plane' || sp === 'planeBig' || sp === 'broad' || sp === 'linden') ? 2 : 1 }); vi0++; } }
  const binMemo = new Map(), getPk = (name) => { if (!binMemo.has(name)) binMemo.set(name, (async () => { const A0 = ctx.A + TDIR, meta = await (await fetch(A0 + name + '.json')).json(); return { meta, buf: meta.pack ? await unpackBin(A0 + name + '.pk.bin', meta.pack) : await (await fetch(A0 + name + '.bin')).arrayBuffer() }; })()); return binMemo.get(name); };
  if (V2 && SCAN && !DENSE) getPk('scan_small02').catch(() => {});   // the scan's 4.5 MB comes down while the first textures do
  const genP = (GENW && V2 && BOUGHS && typeof Worker !== 'undefined') ? (async () => { try {
    const A0 = ctx.A + TDIR, sj = await (await fetch(A0 + 'sprays.json')).json(), bg = {};
    for (const slug of ['jacaranda']) bg[slug] = await getPk('boughs_' + slug);
    return await genInWorkers(genJobs, { sprays: sj, flare: V2, boughs: bg, trunk2: TRK2 });
  } catch (e) { console.warn('[trees] model workers not started', e); return null; } })() : Promise.resolve(null);
  const tl = new THREE.TextureLoader(), A = ctx.A + TDIR;
  const tex = async (f, srgb) => { let t; for (let k = 0; ; k++) { try { t = await tl.loadAsync(A + f); break; } catch (e) { if (k >= 3) throw new Error('trees: texture ' + f + ' did not load'); await new Promise((r) => setTimeout(r, 300 * (k + 1))); } } t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const lateQ = [], texL = (f, srgb, px) => { if (!LATE) return tex(f, srgb); const cv = document.createElement('canvas'); cv.width = cv.height = 2; const g = cv.getContext('2d'); g.fillStyle = 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')'; g.fillRect(0, 0, 2, 2);
    const t = new THREE.Texture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; lateQ.push([t, f]); return t; };
  if (LATE) (async () => { const nap = (ms) => new Promise((r) => setTimeout(r, ms)); for (let i = 0; i < 600 && !window.__ready; i++) await nap(100); await nap(400); const t0 = performance.now(); let n = 0;
    for (let i = 0; i < lateQ.length; i++) { const [t, f] = lateQ[i]; try { const r = await tex(f); t.dispose(); t.image = r.image; t.needsUpdate = true; n++; } catch (e) { console.warn('[trees] late picture not loaded: ' + f); } }
    console.log('[trees] late pictures: ' + n + ' of ' + lateQ.length + ' in ' + Math.round(performance.now() - t0) + ' ms'); window.__treesLate = { n, of: lateQ.length, ms: Math.round(performance.now() - t0) }; })();
  const [b12c, b12n, b14c, b14n, soilC, soilN] = await Promise.all([tex('Bark012_color.jpg', true), tex('Bark012_normal.jpg'), tex('Bark014_color.jpg', true), tex('Bark014_normal.jpg'), tex('Ground048_color.jpg', true), tex('Ground048_normal.jpg')]);
  const feet = (await (await fetch(A + 'feet.json')).json()).feet;
  const [phBarkC, phBarkN, chipsC, chipsN, chipsD, dirtC, dirtN] = await Promise.all([tex('ph_barkbrown02_diff.webp', true), tex('ph_barkbrown02_nor.webp'), texL(SUNM ? 'sun_mulch_color.webp' : PHOTO ? 'photo_mulch_color.webp' : MPATH ? 'ph_chippath_diff.webp' : WC3 ? 'acg_woodchips003_color.webp' : 'ph_woodchips_diff.webp', true, [122, 96, 72]), texL(SUNM ? 'sun_mulch_normal.webp' : PHOTO ? 'photo_mulch_normal.webp' : MPATH ? 'ph_chippath_nor.webp' : WC3 ? 'acg_woodchips003_normal.webp' : 'ph_woodchips_nor.webp', false, [128, 128, 255]), texL(SUNM ? 'sun_mulch_da.webp' : PHOTO ? 'photo_mulch_da.webp' : MPATH ? 'ph_chippath_disp.webp' : WC3 ? 'acg_woodchips003_da.webp' : 'ph_woodchips_disp.webp', false, [128, 230, 0]), tex('ph_parkdirt_diff.webp', true), tex('ph_parkdirt_nor.webp')]);
  for (const t of [phBarkC, phBarkN]) t.repeat.set(0.45, 0.55);   // the generator's bark u/v run 0.45 m round and 0.55 m up per unit; the photo covers 1 m
  const b2G = TRK2 && BARK2 && !PLANE ? [texL('ph_barkwillow02_diff.webp', true, [96, 88, 80]), texL('ph_barkwillow02_nor.webp', false, [128, 128, 255]), texL('ph_barkwillow02_da.webp', false, [128, 230, 0])] : null; if (b2G) for (const t of b2G) t.anisotropy = 8;
  const woodMats = [woodMaterial(shared, b12c, b12n, 0, soilC, null, null, b2G), woodMaterial(shared, b14c, b14n, 1, soilC, null, null, b2G), woodMaterial(shared, b12c, b12n, 2, soilC, null, null, b2G), woodMaterial(shared, phBarkC, phBarkN, 3, soilC, null, null, b2G)];
  const scans = await Promise.all(feet.map(async (f) => { if (V2) return { map: null, normal: b12n }; const normal = await tex('foot_' + f.src + '_normal.webp'); normal.flipY = false; normal.needsUpdate = true; return { map: null, normal }; }));
  const footMatCache = new Map(), footMat = (bark, fi) => { const key = bark + '_' + fi; if (!footMatCache.has(key)) { const fm = woodMaterial(shared, bark === 3 ? phBarkC : bark === 1 ? b14c : b12c, bark === 3 ? phBarkN : bark === 1 ? b14n : b12n, bark, soilC, scans[fi]); fm.side = THREE.DoubleSide; fm.shadowSide = THREE.DoubleSide; footMatCache.set(key, fm); } return footMatCache.get(key); };
  const leafMat = leafMaterial(shared), proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  mark('tex1');
  // leaf sprays (tools/trees_mksprays.py): an atlas of twigs with their leaves per leaf kind; ?trees2=0 falls back to the single-leaf crowns
  let sprays = null; const sprayMat = {};
  if (V2) try {
    sprays = await (await fetch(A + 'sprays.json')).json();
    await Promise.all(Object.keys(sprays).map(async (k) => { const c = await tex('spray_' + k + '_c.webp', true), n = await tex('spray_' + k + '_n.webp');
      for (const t of [c, n]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 8; }
      sprays[k].c = c; sprays[k].n = n; sprayMat[k] = leafMaterial(shared, false, null, sprays[k]); }));
  } catch (e) { console.warn('[trees] leaf sprays not loaded, single leaves instead', e); sprays = null; }
  mark('sprays');
  // whole boughs cut from a scanned tree (tools/trees_mkboughs.py): the near band of the species that name one
  let boughs = null; const boughMats = {};
  if (V2 && BOUGHS && sprays) try {
    for (const slug of ['jacaranda']) {
      const { meta, buf } = await getPk('boughs_' + slug);
      const f32 = (o) => new Float32Array(buf, o[0], o[1]), u32 = (o) => new Uint32Array(buf, o[0], o[1]);
      const list = meta.boughs.map((b) => ({ r0: b.r0, wP: f32(b.wP), wN: f32(b.wN), wUV: f32(b.wUV), wI: u32(b.wI), lP: f32(b.lP), lN: f32(b.lN), lUV: f32(b.lUV), lI: u32(b.lI), lF: u32(b.lF), cen: f32(b.cen) }));
      const [lc, ln, wc, wn] = await Promise.all([tex('bough_' + slug + '_leaf.webp', true), texL('bough_' + slug + '_leaf_n.webp', false, [128, 128, 255]), texL('bough_' + slug + '_wood.webp', true, [92, 82, 72]), texL('bough_' + slug + '_wood_n.webp', false, [128, 128, 255])]);
      for (const t of [lc, ln, wc, wn]) { if (FULL) t.flipY = false; t.anisotropy = 8; t.needsUpdate = true; } for (const t of [lc, ln]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      const lm = leafMaterial(shared, false, null, { c: lc, n: ln, mean: meta.mean_srgb.map((v) => Math.pow(v, 2.2)), trans: 1.45, glow: 4.0 });
      boughs = boughs || {}; boughs[slug] = { list }; boughMats[slug] = { leaf: lm, wood: woodMaterial(shared, wc, wn, 4, soilC) };
    }
  } catch (e) { console.warn('[trees] boughs not loaded, spray cards instead', e); boughs = null; }
  mark('boughs');
  // a whole scanned young tree (tools/trees_mkscan.py): trunk, limbs, twigs and leaves as scanned, shading data baked per vertex
  let scan = null;
  if (V2 && SCAN && sprays) try {
    const slug = 'small02', dslug = DENSE ? 'small02d' : slug, { meta: q, buf } = await getPk('scan_' + dslug);
    const [lc, ln, wc, wn] = await Promise.all([tex('scan_' + slug + '_leaf.webp', true), texL('scan_' + slug + '_leaf_n.webp', false, [128, 128, 255]), texL('scan_' + slug + '_wood.webp', true, [92, 84, 76]), texL('scan_' + slug + '_wood_n.webp', false, [128, 128, 255])]);
    for (const t of [lc, ln, wc, wn]) { if (FULL) t.flipY = false; t.anisotropy = 8; t.needsUpdate = true; } for (const t of [lc, ln]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    mark('scan_fetch');
    if (q.v !== 2) throw new Error('scan file is not the round-16 format');
    const f32 = (o) => new Float32Array(buf, o[0], o[1]), u16 = (o) => new Uint16Array(buf, o[0], o[1]), u8 = (o) => new Uint8Array(buf, o[0], o[1]);
    // wood: positions and uvs are 16-bit in the file; the index comes in parts (trunk, then the twigs longest first)
    const mkWood = (d) => { const g = new THREE.BufferGeometry(), pq = u16(d.P), n = pq.length / 3, P0 = new Float32Array(n * 3), ao = u8(d.AO), aw = new Uint8Array(n * 4);
      for (let i = 0; i < n * 3; i++) P0[i] = d.lo[i % 3] + pq[i] / 65535 * (d.hi[i % 3] - d.lo[i % 3]);
      for (let i = 0; i < n; i++) { aw[i * 4] = ao[i]; aw[i * 4 + 1] = 255; aw[i * 4 + 3] = 255; }
      g.setAttribute('position', new THREE.BufferAttribute(P0, 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(buf, d.N[0], d.N[1]), 4, true)); g.setAttribute('uv', new THREE.BufferAttribute(u16(d.UV), 2, true)); g.setAttribute('aW', new THREE.BufferAttribute(aw, 4, true));
      // the scan's base cap (pushed under the ground by the tool) is left out: its texture is not bark
      const I1 = [], cnt = []; for (const part of d.I) { const I0 = u16(part.I), b0 = part.base; for (let i = 0; i < I0.length; i += 3) { const a = I0[i] + b0, b = I0[i + 1] + b0, c = I0[i + 2] + b0; if (P0[a * 3 + 1] > 0.02 && P0[b * 3 + 1] > 0.02 && P0[c * 3 + 1] > 0.02) I1.push(a, b, c); } cnt.push(I1.length); }
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(I1), 1)); g.userData.parts = cnt; return g; };
    const wgAll = mkWood(q.wood0), wgThin = mkWood(q.wood1), wgBig = new THREE.BufferGeometry(); for (const k in wgAll.attributes) wgBig.setAttribute(k, wgAll.attributes[k]); wgBig.setIndex(wgAll.index);
    const nTw = q.wood0.tris - q.wood0.trunk_tris, nBig = wgAll.userData.parts[0] + Math.floor(nTw * (TWIGS ? 0.15 : 0.75)) * 3; wgBig.setDrawRange(0, nBig);   // the trunk and the longest twigs
    if (GNARL) { const P0 = wgAll.attributes.position.array, N0 = wgAll.attributes.normal.array, v0 = q.wood0.I[1].base;
      for (let i = 0; i < v0; i++) { const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2], k = Math.min(1, Math.max(0, (y - 0.9) / 0.5)), a = ((n3(x * 9, y * 9, z * 9) - 0.5) * 0.020 + (n3(x * 23, y * 23, z * 23) - 0.5) * 0.008) * k;
        for (let c = 0; c < 3; c++) P0[i * 3 + c] += N0[i * 4 + c] / 127 * a; } }
    let wgNetA = null, wgNetB = null, nNetA = 0, nNetB = 0;
    if (NET) try { const { meta: nj, buf: nb } = await getPk('twignet_small02');
      const nP = new Float32Array(nb, nj.P[0], nj.P[1]), nN = new Int8Array(nb, nj.N[0], nj.N[1]), nI = new Uint32Array(nb, nj.I[0], nj.I[1]), n0 = wgAll.attributes.position.count, n1 = nj.nv;
      const cat = (a, b, C) => { const o = new C(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
      const uvT = wgAll.attributes.uv.array, vT = q.wood0.I[1].base;   // the grown twigs wear the scan's own twig bark (uv of one of its twig vertices)
      const uvN = new Uint16Array(n1 * 2), awN = new Uint8Array(n1 * 4); for (let i = 0; i < n1; i++) { const sv = vT + (Math.floor(i / 3) * 7) % (n0 - vT); uvN[i * 2] = uvT[sv * 2]; uvN[i * 2 + 1] = uvT[sv * 2 + 1]; awN[i * 4] = 215; awN[i * 4 + 1] = 255; awN[i * 4 + 3] = 255; }
      if (NETR) for (let i = 0; i < n1; i++) for (let c = 0; c < 3; c++) nP[i * 3 + c] += nN[i * 4 + c] / 127 * NETR;
      const at = wgAll.attributes, I2 = new Uint32Array(nBig + nI.length); I2.set(wgAll.index.array.subarray(0, nBig)); for (let i = 0; i < nI.length; i++) I2[nBig + i] = nI[i] + n0;
      const A4 = { position: new THREE.BufferAttribute(cat(at.position.array, nP, Float32Array), 3), normal: new THREE.BufferAttribute(cat(at.normal.array, nN, Int8Array), 4, true), uv: new THREE.BufferAttribute(cat(at.uv.array, uvN, Uint16Array), 2, true), aW: new THREE.BufferAttribute(cat(at.aW.array, awN, Uint8Array), 4, true) }, ix = new THREE.BufferAttribute(I2, 1);
      const mk = (cnt) => { const g = new THREE.BufferGeometry(); for (const k in A4) g.setAttribute(k, A4[k]); g.setIndex(ix); g.setDrawRange(0, cnt); return g; };
      nNetA = nBig + nI.length; nNetB = nBig + (nj.cuts['0.0022'] || 0); wgNetA = mk(nNetA); wgNetB = mk(nNetB);
    } catch (e) { console.warn('[trees] twig net not loaded', e); wgNetA = null; }
    let wgNear = null; if (TWK && !TWIGS) { wgNear = new THREE.BufferGeometry(); for (const k in wgAll.attributes) if (k !== 'position') wgNear.setAttribute(k, wgAll.attributes[k]); wgNear.setIndex(wgAll.index);
      const P0 = wgAll.attributes.position.array, N0 = wgAll.attributes.normal.array, P1 = new Float32Array(P0), v0 = q.wood0.I[1].base; for (let i = v0 * 3; i < P1.length; i++) P1[i] += N0[Math.floor(i / 3) * 4 + i % 3] / 127 * 0.003; wgNear.setAttribute('position', new THREE.BufferAttribute(P1, 3)); }
    if (TWIGS) { const P0 = wgAll.attributes.position.array, N0 = wgAll.attributes.normal.array, v0 = q.wood0.I[1].base; for (let i = v0 * 3; i < P0.length; i++) P0[i] += N0[Math.floor(i / 3) * 4 + i % 3] / 127 * 0.005; }   // twigs thickened so they survive at screen resolution
    // leaves: the tree's 30,221 sprays, single leaves and green shoots are copies of 29 small meshes (three levels of detail each):
    // a band is built by setting a share of the copies (the file's order is shuffled, so a prefix is an even thinning) at one level
        const cg = [0, 1, 2].map((k) => (q.llo[k] + q.lhi[k]) / 2), eg = [0, 1, 2].map((k) => (q.lhi[k] - q.llo[k]) / 2 + 0.25);
    const lv = q.levels.map((L) => ({ P: f32(L.P), N: f32(L.N), UV: f32(L.UV), F: u8(L.F), I: u16(L.I), rg: L.ranges }));
    const cc = [(q.lo[0] + q.hi[0]) / 2, q.crown0 + (q.hi[1] - q.crown0) * 0.42, (q.lo[2] + q.hi[2]) / 2], ce = [(q.hi[0] - q.lo[0]) / 2, (q.hi[1] - q.crown0) / 2, (q.hi[2] - q.lo[2]) / 2];
    // ?sunvis=1: sun visibility of every piece of the cut-out crown for eight compass directions at 48 degrees (the near band's baked convention):
    // the pieces' areas go into a 10 cm grid, a march from each piece toward the sun adds up what lies in the way; the extinction is set so the same
    // share of pieces is sunlit as in the near band's baked values
    const sunVis8 = (X, n) => { if (q._sv) return q._sv; const CS = 0.10, lo = q.llo, nx = Math.ceil((q.lhi[0] - lo[0]) / CS) + 3, ny = Math.ceil((q.lhi[1] - lo[1]) / CS) + 3, nz = Math.ceil((q.lhi[2] - lo[2]) / CS) + 3, G = new Float32Array(nx * ny * nz);
      const cell = (x, y, z) => { const i = Math.floor((x - lo[0]) / CS) + 1, j = Math.floor((y - lo[1]) / CS) + 1, k = Math.floor((z - lo[2]) / CS) + 1; return (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) ? -1 : (k * ny + j) * nx + i; };
      for (let i = 0; i < n; i++) { const c = cell(X[i * 4], X[i * 4 + 1], X[i * 4 + 2]); if (c >= 0) G[c] += X[i * 4 + 3] * X[i * 4 + 3]; }
      const el = 48 * Math.PI / 180, tau = new Float32Array(n * 8);
      for (let d = 0; d < 8; d++) { const az = d * Math.PI / 4, dx = Math.cos(el) * Math.cos(az) * CS, dy = Math.sin(el) * CS, dz = Math.cos(el) * Math.sin(az) * CS;
        for (let i = 0; i < n; i++) { let x = X[i * 4] + dx * 1.5, y = X[i * 4 + 1] + dy * 1.5, z = X[i * 4 + 2] + dz * 1.5, sum = 0; for (let t = 0; t < 64; t++) { const c = cell(x, y, z); if (c < 0) break; sum += G[c]; x += dx; y += dy; z += dz; } tau[i * 8 + d] = sum; } }
      const nearV = u8(q.inst.V); let lit = 0; for (let i = 0; i < nearV.length; i++) if (nearV[i] > 127) lit++; const share = Math.min(0.8, Math.max(0.2, lit / nearV.length));
      const st = Float32Array.from(tau).sort(), tq = Math.max(st[Math.floor(st.length * share)], 1e-6), kx = Math.LN2 / tq, V = new Uint8Array(n * 8);
      for (let i = 0; i < n * 8; i++) V[i] = Math.round(255 * Math.min(1, 0.04 + 0.96 * Math.exp(-kx * tau[i])));
      q._sv = V; console.log('[trees] sunvis: ' + n + ' pieces, share sunlit ' + share.toFixed(2)); return V; };
    const mkBand = (B) => { const src = q[B.src], X = f32(src.X), Qt = new Int16Array(buf, src.Q[0], src.Q[1]), A8 = u8(src.A), NI = src.n, V8 = (SUNVIS && B.src === 'inst0') ? sunVis8(X, NI) : u8(src.V), L = lv[B.level], nUse = Math.round(NI * B.keep), take = (i) => (q.kinds[A8[i * 4]] !== 2 || (i * 0.61803 % 1) < B.stems) && (!CLUMP || n3(X[i * 4] * 2.2, X[i * 4 + 1] * 2.2, X[i * 4 + 2] * 2.2) > 0.43 || (i * 0.3819 % 1) < 0.12); let nv = 0, ni = 0;
      for (let i = 0; i < nUse; i++) if (take(i)) { const r = L.rg[A8[i * 4]]; nv += r[1]; ni += r[3]; }
      const pos = new Float32Array(nv * 3), nrm = new Int8Array(nv * 4), col = new Uint8Array(nv * 4), uv = new Float32Array(nv * 2), va = new Uint8Array(nv * 4), vb = new Uint8Array(nv * 4), fdv = new Uint8Array(nv), crw = new Int8Array(nv * 3), idx = new Uint32Array(ni); let v = 0, k = 0;
      for (let i = 0; i < nUse; i++) { if (!take(i)) continue;
        const pi = A8[i * 4], r = L.rg[pi], tx = X[i * 4], ty = X[i * 4 + 1], tz = X[i * 4 + 2], s = X[i * 4 + 3] * B.scale, qx = Qt[i * 4] / 32767, qy = Qt[i * 4 + 1] / 32767, qz = Qt[i * 4 + 2] / 32767, qw = Qt[i * 4 + 3] / 32767;
        const m00 = 1 - 2 * (qy * qy + qz * qz), m01 = 2 * (qx * qy - qz * qw), m02 = 2 * (qx * qz + qy * qw), m10 = 2 * (qx * qy + qz * qw), m11 = 1 - 2 * (qx * qx + qz * qz), m12 = 2 * (qy * qz - qx * qw), m20 = 2 * (qx * qz - qy * qw), m21 = 2 * (qy * qz + qx * qw), m22 = 1 - 2 * (qx * qx + qy * qy);
        let cx = (tx - cc[0]) / (ce[0] * ce[0]), cy = (ty - cc[1]) / (ce[1] * ce[1]), cz = (tz - cc[2]) / (ce[2] * ce[2]); const cl = Math.hypot(cx, cy, cz) || 1; cx /= cl; cy /= cl; cz /= cl;
        const kind = q.kinds[pi], ao = A8[i * 4 + 1], h = A8[i * 4 + 2] / 255, g = A8[i * 4 + 3] / 255, cr = Math.round(255 * (0.5 + 0.5 * g * (0.7 + 0.3 * h))), cgn = kind === 2 ? 0 : Math.round(255 * (h > 0.95 ? 0.3 + 0.4 * g : h > 0.85 ? 0.1 * g : 0));
        for (let j = 0; j < r[1]; j++, v++) { const o = (r[0] + j) * 3, px = L.P[o], py = L.P[o + 1], pz = L.P[o + 2], nx0 = L.N[o], ny0 = L.N[o + 1], nz0 = L.N[o + 2];
          pos[v * 3] = tx + s * (m00 * px + m01 * py + m02 * pz); pos[v * 3 + 1] = ty + s * (m10 * px + m11 * py + m12 * pz); pos[v * 3 + 2] = tz + s * (m20 * px + m21 * py + m22 * pz);
          let nx = m00 * nx0 + m01 * ny0 + m02 * nz0, ny = m10 * nx0 + m11 * ny0 + m12 * nz0, nz = m20 * nx0 + m21 * ny0 + m22 * nz0; const sg = nx * cx + ny * cy + nz * cz < -0.2 ? -B.own : B.own;
          nx = nx * sg + cx * B.crown; ny = ny * sg + cy * B.crown; nz = nz * sg + cz * B.crown; const nl = 127 / (Math.hypot(nx, ny, nz) || 1);
          nrm[v * 4] = Math.round(nx * nl); nrm[v * 4 + 1] = Math.round(ny * nl); nrm[v * 4 + 2] = Math.round(nz * nl);
          const bl = L.F[r[0] + j]; col[v * 4] = B.level === 3 ? cr : Math.max(0, Math.min(255, Math.round(cr * (0.55 + 0.9 * bl / 255)))); col[v * 4 + 1] = bl ? cgn : 0; col[v * 4 + 2] = ao; col[v * 4 + 3] = bl ? 255 : 0;
          for (let c = 0; c < 3; c++) crw[v * 3 + c] = Math.max(-127, Math.min(127, Math.round((pos[v * 3 + c] - cg[c]) / eg[c] / 1.6 * 127)));
          uv[v * 2] = L.UV[(r[0] + j) * 2]; uv[v * 2 + 1] = L.UV[(r[0] + j) * 2 + 1];
          { const v4 = v * 4, i8 = i * 8; va[v4] = V8[i8]; va[v4 + 1] = V8[i8 + 1]; va[v4 + 2] = V8[i8 + 2]; va[v4 + 3] = V8[i8 + 3]; vb[v4] = V8[i8 + 4]; vb[v4 + 1] = V8[i8 + 5]; vb[v4 + 2] = V8[i8 + 6]; vb[v4 + 3] = V8[i8 + 7]; } fdv[v] = Math.floor(((i * 0.7548776662 + 0.37) % 1) * 256); }
        const b0 = v - r[1]; for (let j = 0; j < r[3]; j++) idx[k++] = b0 + L.I[r[2] + j]; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 4, true)); g.setAttribute('aLeaf', new THREE.BufferAttribute(col, 4, true)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('aCrown', new THREE.BufferAttribute(crw, 3, true)); g.setAttribute('aVisA', new THREE.BufferAttribute(va, 4, true)); g.setAttribute('aVisB', new THREE.BufferAttribute(vb, 4, true)); g.setAttribute('aFd', new THREE.BufferAttribute(fdv, 1, true)); g.setIndex(new THREE.BufferAttribute(idx, 1)); return { fade: B.fade, lg: g, wg: B.wood === 'all' ? wgAll : B.wood === 'big' ? wgBig : wgThin, wcount: B.wood === 'netA' ? nNetA : B.wood === 'netB' ? nNetB : B.wood === 'all' || B.wood === 'near' ? wgAll.index.count : B.wood === 'big' ? nBig : wgThin.index.count, wg: B.wood === 'netA' ? wgNetA : B.wood === 'netB' ? wgNetB : B.wood === 'near' ? wgNear : B.wood === 'all' ? wgAll : B.wood === 'big' ? wgBig : wgThin, d: B.d, ltris: ni / 3, geo: B.src === 'inst' }; };
    const CUT = [{ d: 8.5, src: 'inst0', level: 3, keep: 1, scale: 1, own: 0.8, crown: 0.55, stems: 1, wood: 'big' }, { d: 44, src: 'inst0', level: 3, keep: 0.2, scale: 1.9, own: 0.8, crown: 0.55, stems: 1, wood: 'thin' }];
    // the kept round-13 crown (CUT): every piece of the scan thinned to a 3 x 4 grid over its picture (the leaf outlines are the texture's cut-out); one in five, 1.9 times larger, to 44 m
    let SB = TWIGS ? [{ d: 4.2, src: 'inst', level: 0, keep: 1, scale: 1, own: 1, crown: 0.12, stems: 1, wood: 'all' }, { d: 8.0, src: 'inst', level: 1, keep: 1, scale: 1, own: 1, crown: 0.15, stems: 0.5, wood: 'all' },
      { d: 14, src: 'inst', level: 2, keep: 0.5, scale: 1.4, own: 0.8, crown: 0.5, stems: 0.3, wood: 'big' }, { d: 26, src: 'inst', level: 2, keep: 0.34, scale: 1.7, own: 0.8, crown: 0.5, stems: 0, wood: 'thin' }, { d: 44, src: 'inst', level: 2, keep: 0.16, scale: 2.4, own: 0.8, crown: 0.55, stems: 0, wood: 'thin' }]
      : HYBRID ? [{ d: 4.6, src: 'inst', level: 0, keep: 1, scale: BIG ? 1.25 : 1, own: 1, crown: 0.12, stems: 1, wood: TWK ? 'near' : 'big' }].concat(CUT) : CUT;
    if (GEOFAR && HYBRID && !TWIGS) SB = [SB[0], { d: 13, src: 'inst', level: 1, keep: 1, scale: 1, own: 1, crown: 0.15, stems: 1, wood: 'big' }, { d: 24, src: 'inst', level: 2, keep: 1, scale: 1.15, own: 0.9, crown: 0.3, stems: 0.6, wood: 'big' }, CUT[1]];
    if (wgNetA) for (const b of SB) if (b.wood === 'big') b.wood = b.d < 5 ? 'netA' : 'netB';
    if (GEOFAR && LODFADE && HYBRID && !TWIGS) { SB[0].fade = [3.8, 4.8, -2, -1]; SB[1].fade = [11.6, 13.0, 3.8, 4.8]; SB[2].fade = [22.0, 24.0, 11.6, 13.0]; SB[3].fade = [1e9, 2e9, 22.0, 24.0]; }
    else if (LODFADE && HYBRID && !TWIGS) { SB[0].fade = [3.8, 4.8, -2, -1]; SB[1].fade = [8.0, 9.4, 3.8, 4.8]; SB[2].fade = [1e9, 2e9, 8.0, 9.4]; }
    const proxy = new THREE.BufferGeometry(); proxy.setAttribute('position', new THREE.BufferAttribute(f32(q.proxy.P), 3)); proxy.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, q.proxy.I[0], q.proxy.I[1]), 1));
    { const bd = phBarkC.clone(), bn = phBarkN.clone(); for (const t of [bd, bn]) { t.repeat.set(1, 1); t.needsUpdate = true; } let b2 = null; if (BARK2) { b2 = await Promise.all(PLANE ? [tex('plane_bark_c.webp', true), tex('plane_bark_n.webp'), tex('plane_bark_da.webp')] : b2G || [texL('ph_barkwillow02_diff.webp', true, [96, 88, 80]), texL('ph_barkwillow02_nor.webp', false, [128, 128, 255]), texL('ph_barkwillow02_da.webp', false, [128, 230, 0])]); for (const t of b2) t.anisotropy = 8; }
      woodMats.push(woodMaterial(shared, wc, wn, 5, chipsC, null, /[?&]barkd=1/.test(location.search) ? [bd, bn] : null, b2)); }   // the fine tiling bark read as 'blurry, grey-purple' in the pit view: off (?barkd=1)
    const lmGeo = leafMaterial(shared, false, null, { c: lc, n: ln, mean: [0.0788, 0.1440, 0.0433], trans: GLOW ? 1.7 : 1.1, glow: GLOW ? 2.2 : 1.0, selfK: 0.85, own: true, spec: GLOSS ? 3.0 : 0.5, sat: 0.72, shade: 1.0, fwd: 0.0, geo: true, thru: [0.92, 1.0, 0.72] }); lmGeo.roughness = GLOSS ? 0.34 : 0.62;
    const lmCut = leafMaterial(shared, false, null, { c: lc, n: ln, mean: [0.0788, 0.1440, 0.0433], trans: BACK ? 0.95 : 1.5, glow: BACK ? 0.8 : 3.5, selfK: 0.85, own: true, vis8: SUNVIS, spec: 2.6, sat: 1.0, shade: 1.0, fwd: 0.0, thru: BACK ? [0.78, 1.05, 0.34] : [1.0, 1.1, 0.55] }); lmCut.roughness = 0.42;
    const geoSpec = { c: lc, n: ln, mean: [0.0788, 0.1440, 0.0433], trans: GLOW ? 1.7 : 1.1, glow: GLOW ? 2.2 : 1.0, selfK: 0.85, own: true, spec: GLOSS ? 3.0 : 0.5, sat: 0.72, shade: 1.0, fwd: 0.0, geo: true, thru: [0.92, 1.0, 0.72] }, cutSpec = { c: lc, n: ln, mean: [0.0788, 0.1440, 0.0433], trans: BACK ? 0.95 : 1.5, glow: BACK ? 0.8 : 3.5, selfK: 0.85, own: true, vis8: SUNVIS, spec: 2.6, sat: 1.0, shade: 1.0, fwd: 0.0, thru: BACK ? [0.78, 1.05, 0.34] : [1.0, 1.1, 0.55] };
    mark('scan_wood');
    const bands = SB.map(mkBand); mark('scan_bands');
    for (const b of bands) { if (b.fade) { b.mat = leafMaterial(shared, false, null, Object.assign({}, b.geo ? geoSpec : cutSpec, { fade: b.fade })); b.mat.roughness = b.geo ? (GLOSS ? 0.34 : 0.62) : 0.42; }
      if (FRINGE && !b.geo) { b.fmat = leafMaterial(shared, false, null, Object.assign({}, cutSpec, { fringe: true, fade: b.fade })); b.fmat.roughness = 0.42; } }
    scan = { q, lc, bands, wgThin, proxy, bark: woodMats.length - 1, lm: TWIGS ? lmGeo : lmCut, lmGeo, lmCut };
  } catch (e) { console.warn('[trees] scanned tree not loaded', e); scan = null; }
  const models = [], bySpecies = {};
  let vi = 0;
  mark('tex_scan');
  const genT = (sprays && boughs) ? await genP : null; let nGenW = 0; mark('gen_wait');   // (the workers were given the sprays and the boughs: if either did not load here, their trees are not the ones wanted)
  for (const [sp, n] of VARIANTS) {
    bySpecies[sp] = [];
    for (let k = 0; k < n; k++) {
      const T = (genT && genT[vi]) ? (nGenW++, genT[vi]) : makeTree(SPECIES[sp], 101 + vi * 37 + k * 11, { sprays, flare: V2, boughs, trunk2: TRK2 });
      const big = sp === 'planeBig' || sp === 'broad', fi = big ? (k % 2 ? 0 : 2) : (vi + k) % 2, foot = footGeometry(feet[fi], T, SPECIES[sp], 3 + vi * 5 + k);
      if (!V2) T.info.rMin = foot.rMin; foot.fi = fi;
      const wpos = new THREE.BufferAttribute(T.wood.pos, 3), wnrm = new THREE.BufferAttribute(T.wood.nrm, 3), wuv = new THREE.BufferAttribute(T.wood.uv, 2), waw = new THREE.BufferAttribute(T.wood.col, 4, true), widx = new THREE.BufferAttribute(T.wood.idx, 1);
      const lods = [];
      for (let l = 0; l < 3; l++) {
        const wg = new THREE.BufferGeometry(); wg.setAttribute('position', wpos); wg.setAttribute('normal', wnrm); wg.setAttribute('uv', wuv); wg.setAttribute('aW', waw); wg.setIndex(widx); const wc = l === 2 ? T.wood.far[1] : T.wood.cuts[l]; wg.setDrawRange(l === 2 ? T.wood.far[0] : 0, wc);
        if (l === 2) { lods.push({ wg, wcount: wc, wstart: T.wood.far[0] }); break; }
        const L = T.leaves[l], lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(L.pos, 3)); lg.setAttribute('normal', new THREE.BufferAttribute(L.nrm, 4, true)); lg.setAttribute('aLeaf', new THREE.BufferAttribute(L.col, 4, true)); lg.setAttribute('aCrown', new THREE.BufferAttribute(L.crw, 3, true)); if (L.uv) lg.setAttribute('uv', new THREE.BufferAttribute(L.uv, 2)); lg.setIndex(new THREE.BufferAttribute(L.idx, 1));
        lods.push({ wg, lg, wcount: wc, tris: wc / 3 + L.idx.length / 3 });
      }
      if (T.bough) {   // the near band's crown: the boughs' own leaves and wood
        const B = T.bough, bm = boughMats[SPECIES[sp].bough], lg = new THREE.BufferGeometry(), bw = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(B.leaf.pos, 3)); lg.setAttribute('normal', new THREE.BufferAttribute(B.leaf.nrm, 4, true)); lg.setAttribute('aLeaf', new THREE.BufferAttribute(B.leaf.col, 4, true)); lg.setAttribute('aCrown', new THREE.BufferAttribute(B.leaf.crw, 3, true)); lg.setAttribute('uv', new THREE.BufferAttribute(B.leaf.uv, 2)); lg.setIndex(new THREE.BufferAttribute(B.leaf.idx, 1));
        bw.setAttribute('position', new THREE.BufferAttribute(B.wood.pos, 3)); bw.setAttribute('normal', new THREE.BufferAttribute(B.wood.nrm, 3)); bw.setAttribute('uv', new THREE.BufferAttribute(B.wood.uv, 2)); bw.setAttribute('aW', new THREE.BufferAttribute(B.wood.col, 4, true)); bw.setIndex(new THREE.BufferAttribute(B.wood.idx, 1));
        Object.assign(lods[0], { lg, bw, mat: bm.leaf, bwMat: bm.wood, tris: lods[0].wcount / 3 + B.leaf.idx.length / 3 + B.wood.idx.length / 3 });
      }
      // the shadow pass's crown: a few hundred large leaves, drawn in toward the crown's middle so the sunlit shell stays lit
      const PL = T.leaves[2], pp = new Float32Array(PL.pos), pc = [(T.info.lo[0] + T.info.hi[0]) / 2, (T.info.lo[1] + T.info.hi[1]) / 2, (T.info.lo[2] + T.info.hi[2]) / 2];
      for (let q = 0; q < pp.length; q++) pp[q] = pc[q % 3] + (pp[q] - pc[q % 3]) * 0.88;
      const proxy = new THREE.BufferGeometry(); proxy.setAttribute('position', new THREE.BufferAttribute(pp, 3)); proxy.setIndex(new THREE.BufferAttribute(PL.idx, 1));
      const imp = { R: T.info.radius + 0.5, y0: T.info.lo[1] - 0.5, y1: T.info.hi[1] + 0.5 };
      const cards = T.info.cards, m = { sp, spec: SPECIES[sp], info: T.info, lods, foot, proxy, imp, trees: [], id: models.length, spray: cards ? sprays[SPECIES[sp].spray] : null, leafMat: cards ? sprayMat[SPECIES[sp].spray] : leafMat, lodD: T.bough ? [17, 44] : cards ? LOD_CARD : LOD_D };
      models.push(m); bySpecies[sp].push(m); vi++;
    }
  }

  const heroScan = {};
  if (scan) { const q = scan.q, m = { sp: 'scan', scan: true, fRange: [1.25, 2.4], spec: { H: q.H, trunkR: q.trunkR, bark: scan.bark }, info: { rMin: q.rMin, radius: q.radius, lo: q.lo, hi: q.hi },
      lods: scan.bands.map((b) => ({ wg: b.wg, lg: b.lg, wcount: b.wcount, tris: b.wcount / 3 + b.ltris, mat: b.mat || (b.geo ? scan.lmGeo : scan.lmCut), fmat: b.fmat, rng: b.fade ? [b.fade[2], b.fade[1]] : null })).concat([{ wg: scan.wgThin, wcount: scan.wgThin.index.count, wstart: 0 }]),
      foot: models[0].foot, proxy: scan.proxy, imp: { R: q.radius + 0.5, y0: (q.crown0 || 1.5) - 0.5, y1: q.hi[1] + 0.5 }, trees: [], id: models.length, spray: { c: scan.lc }, leafMat: scan.lm, lodD: scan.bands.map((b) => b.d) }; m.impLg = scan.bands[scan.bands.length - 1].lg;
    models.push(m); for (const sp of ['ginkgo', 'linden', 'oak', 'pear', 'broad', 'plane']) heroScan[sp] = [m]; }
  mark('models');
  // ---- one tree at a time: species, model, size, colour, matrix
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), Sc = new THREE.Vector3();
  const pick = (r, table) => { let a = 0; for (const [k, w] of table) { a += w; if (r < a) return k; } return table[table.length - 1][0]; };
  // the lead's collision circles (tag 'tree') follow the park trees that are moved or left out
  const circ = game.statics && game.statics.circ, circOf = (t) => {
    if (!circ) return null; const a = circ.get(game.statics.key(Math.floor(t.x / game.statics.cell), Math.floor(t.y / game.statics.cell)));
    if (a) for (const o of a) if (o.tag === 'tree' && o.on && Math.abs(o.x - t.x) < 0.02 && Math.abs(o.y - t.y) < 0.02) return o; return null; };
  let nCirc = 0;
  const sigs = new Map(); for (const g of (ctx.city.props.signal || [])) { const k = Math.floor(g[0] / 16) + ',' + Math.floor(g[1] / 16); if (!sigs.has(k)) sigs.set(k, []); sigs.get(k).push(g); }
  const nearSignal = (t) => { const cx = Math.floor(t.x / 16), cy = Math.floor(t.y / 16); for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) { const l = sigs.get(i + ',' + j); if (l) for (const g of l) if (Math.hypot(g[0] - t.x, g[1] - t.y) < 12) return true; } return false; };
  for (const t of trees) {
    const hx0 = t.from ? t.from[0] : t.x, hy0 = t.from ? t.from[1] : t.y, r = (k) => h2(t.from ? hx0 : t.x, t.from ? hy0 : t.y, k);   // a tree moved off the paving keeps the species, size and colour its planting spot gave it
    const co = t.park ? circOf(t) : null;
    if (t.park && r(15) < 0.2) { t.skip = true; if (co) { co.on = false; nCirc++; } continue; }      // lawns have gaps
    if (t.hero) {   // a census tree: its own species, and a size from its trunk (2015 diameter plus about a decade's growth)
      const sp = t.hero.sp, list = heroScan[sp] || bySpecies[sp] || bySpecies.pear, m = list[Math.floor(r(3) * list.length) % list.length], S = m.spec, fr = m.fRange || [0.5, 1.35];
      const rT = (t.hero.dbh + 2) * 0.0127, f = Math.max(fr[0], Math.min(fr[1], rT / S.trunkR)) * (0.86 + 0.28 * r(16)), cr = m.info.radius * f;
      const sAcross = Math.max(m.scan ? 0.64 : 0.55, Math.min(1.0, (t.wall + 0.9) / cr)), sAlong = m.scan ? 0.9 + 0.2 * r(5) : 0.82 + 0.34 * r(5), sy = 0.88 + 0.24 * r(6), qt = m.scan ? Math.floor(r(8) * 4) : (r(8) < 0.5 ? 2 : 0);
      P.set(t.x, m.scan ? 0.15 - 0.03 * f : 0.15, -t.y); E.set((r(7) - 0.5) * 0.03, t.kh + qt * Math.PI / 2, (r(9) - 0.5) * 0.03, 'YXZ'); Q.setFromEuler(E); if (qt % 2) Sc.set(f * sAcross, f * sy, f * sAlong); else Sc.set(f * sAlong, f * sy, f * sAcross); M.compose(P, Q, Sc); if (m.scan) { t.cy = S.H * f * 0.55; const q0 = scan.q; const rr = q0.radius * Math.max(Sc.x, Sc.z) * 1.05 + 0.2; t.crB = new THREE.Box3(new THREE.Vector3(t.x - rr, 0.15 + q0.crown0 * Sc.y * 0.92 - 0.2, -t.y - rr), new THREE.Vector3(t.x + rr, 0.15 + q0.H * Sc.y + 0.3, -t.y + rr)); }
      t.R = m.info.rMin * f * Math.min(sAlong, sAcross) * 0.97 * (m.scan && FLARE ? 1.3 : 1); t.m = new Float32Array(M.elements); t.yaw = E.y; t.sc = [Sc.x, Sc.y, Sc.z]; t.model = m; t.f = f; t.rad = Math.max(cr, S.H * f * 0.6);
      const base = LEAFCOL[sp] || LEAFCOL.pear, yy = Math.pow(r(10), 2.2) * (YELLOWS[sp] || 0.2) * 1.6, br = 0.8 + 0.4 * r(14);
      t.c = [base[0] * br * (1 + 1.0 * yy), base[1] * br * (1 + 0.38 * yy), base[2] * br * (1 - 0.4 * yy)];
      m.trees.push(t); continue;
    }
    if (t.from) { const o = circOf({ x: t.from[0], y: t.from[1] }); if (o) { o.on = false; nCirc++; game.statics.addCircle(t.x, t.y, 0.25, 'tree'); } }
    if (!t.park && nearSignal(t)) { t.skip = true; const c2 = circOf(t); if (c2) { c2.on = false; nCirc++; } continue; }   // street corners are kept clear of trees
    let sp;
    if (t.park) {
      sp = pick(r(1), [['planeBig', 0.42], ['broad', 0.36], ['locust', 0.10], ['plane', 0.12]]);
      const ox = t.x, oy = t.y; t.x = ox + (r(11) - 0.5) * 7.0; t.y = oy + (h2(ox, oy, 12) - 0.5) * 7.0; t.h2 = [ox, oy];          // park trees are not planted on a grid
      if (co) { co.on = false; t.co = true; nCirc++; }
    } else {
      const cx = Math.floor(t.x / 70), cy = Math.floor(t.y / 70), lead = pick(h2(cx, cy, 5), [['plane', 0.38], ['locust', 0.36], ['pear', 0.26]]);
      sp = r(1) < 0.68 ? lead : pick(r(2), [['plane', 0.36], ['locust', 0.36], ['pear', 0.28]]);
      if (t.wall < 2.3) sp = 'pear'; else if (t.wall < 3.2 && sp === 'plane') sp = 'locust';
    }
    const list = bySpecies[sp], m = list[Math.floor(r(3) * list.length) % list.length], S = m.spec;
    let f = t.park ? (1.0 + 0.3 * Math.min(1, Math.max(0, (t.s - 1) / 0.7))) * (0.72 + 0.6 * r(4)) : (0.78 + 0.28 * Math.min(1, Math.max(0, (t.s - 0.8) / 0.5))) * (0.72 + 0.5 * r(4));
    if (r(13) < (t.park ? 0.12 : 0.07)) f *= 0.55;                                         // a young replacement tree now and then
    const cr = m.info.radius * f;
    const sAcross = t.park ? 1 : Math.max(0.5, Math.min(1.0, (t.wall + 0.9) / cr)), sAlong = 0.9 + 0.25 * r(5), sy = 0.86 + 0.3 * r(6);
    P.set(t.x, 0.15, -t.y);
    E.set((r(7) - 0.5) * 0.14, t.park ? r(8) * 6.283 : t.kh + (r(8) < 0.5 ? Math.PI : 0), (r(9) - 0.5) * 0.14, 'YXZ'); Q.setFromEuler(E);
    Sc.set(f * sAlong, f * sy, f * sAcross);
    M.compose(P, Q, Sc);
    t.R = m.info.rMin * f * Math.min(sAlong, sAcross) * 0.97;
    t.m = new Float32Array(M.elements); t.yaw = E.y; t.sc = [Sc.x, Sc.y, Sc.z]; t.model = m; t.f = f; t.rad = Math.max(cr, S.H * f * 0.6);
    // colour: species green, brightness and a share of trees turning yellow
    const base = LEAFCOL[sp], yy = Math.pow(r(10), 2.2) * YELLOWS[sp] * 1.6, br = 0.72 + 0.56 * r(14);
    t.c = [base[0] * br * (1 + 1.0 * yy), base[1] * br * (1 + 0.38 * yy), base[2] * br * (1 - 0.4 * yy)];
    if (t.co) game.statics.addCircle(t.x, t.y, Math.max(0.22, S.trunkR * f * 1.1), 'tree');
    m.trees.push(t);
  }

  mark('pertree');
  // ---- what is drawn, filled each time the camera moves:
  //   band 0 (to 16 m) and band 1 (to 50 m): real leaf and wood meshes with the scanned foot, per model;
  //   beyond: the trunk and big limbs as geometry, the crown as one camera-facing impostor quad (all models in one draw call);
  //   shadow pass: per tree within the shadow map's sharp range, the big limbs and a crown proxy of a few hundred large leaves.
  const impMat = leafMaterial(shared, true, bakeImpostors(world.renderer, models)); impMat.alphaToCoverage = true;
  mark('impostors');
  // the proxy's big leaves are cut into leaf-sized pieces in the shadow pass (about half of each is let through), so the shade dapples
  const proxyDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  proxyDepth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec3 vPP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vPP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vPP;').replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { vec3 q = floor(vPP / 0.19 + vec3(0.37, 0.11, 0.73)); float h = fract(sin(dot(q, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        vec3 q2 = floor(vPP / 0.47); float h2 = fract(sin(dot(q2, vec3(269.5, 183.3, 246.1))) * 43758.5453);
        if (h < 0.42 + 0.3 * h2) discard; }`);
  };
  proxyDepth.customProgramCacheKey = () => 'stTreeProxyDepth1';
  for (const m of models) {
    const cap = Math.max(1, m.trees.length); m.meshes = [];
    m.nb = m.lods.length - 1; const FL = m.lods[m.nb];
    for (let l = 0; l < m.nb; l++) {
      const wood = new THREE.InstancedMesh(m.lods[l].wg, woodMats[m.spec.bark], cap), leaf = new THREE.InstancedMesh(m.lods[l].lg, m.lods[l].mat || m.leafMat, cap);
      wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (m.scan) leaf.instanceMatrix.setUsage(THREE.DynamicDrawUsage); else leaf.instanceMatrix = wood.instanceMatrix;   // round 28: a scan tree's crown has its own list, so a crown out of view (looking down at a pit) is not drawn
      leaf.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); leaf.instanceColor.setUsage(THREE.DynamicDrawUsage);
      const ft = new THREE.InstancedMesh(m.foot.g, footMat(m.spec.bark, m.foot.fi), cap); ft.instanceMatrix = wood.instanceMatrix; ft.userData.kind = 'st_treefoot';
      for (const o of [wood, leaf, ft]) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = !(m.scan && o === leaf); o.count = 0; o.matrixAutoUpdate = false; o.userData.kind = o.userData.kind || 'st_tree'; group.add(o); }
      if (V2) wood.renderOrder = 4;   // after the pits' holes are in the depth buffer: the foot goes down into the mulch
      let bwm = null; if (m.lods[l].bw) { bwm = new THREE.InstancedMesh(m.lods[l].bw, m.lods[l].bwMat, cap); bwm.instanceMatrix = wood.instanceMatrix; Object.assign(bwm, { frustumCulled: false, castShadow: false, receiveShadow: true, count: 0, matrixAutoUpdate: false }); bwm.userData.kind = 'st_tree'; group.add(bwm); }
      let fr = null; if (m.lods[l].fmat) { fr = new THREE.InstancedMesh(m.lods[l].lg, m.lods[l].fmat, cap); fr.instanceMatrix = leaf.instanceMatrix; fr.instanceColor = leaf.instanceColor; Object.assign(fr, { frustumCulled: false, castShadow: false, receiveShadow: false, count: 0, matrixAutoUpdate: false, renderOrder: 7 }); fr.userData.kind = 'st_tree'; group.add(fr); }
      m.meshes.push({ wood, leaf, foot: ft, bw: bwm, fr });
    }
    const farWood = new THREE.InstancedMesh(FL.wg, woodMats[m.spec.bark], cap); farWood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    Object.assign(farWood, { frustumCulled: false, castShadow: false, receiveShadow: true, count: 0, matrixAutoUpdate: false }); farWood.userData.kind = 'st_tree'; group.add(farWood); m.farWood = farWood;
    // shadow casters: drawn only in the shadow pass
    const cw = new THREE.BufferGeometry(); for (const k in FL.wg.attributes) cw.setAttribute(k, FL.wg.attributes[k]); cw.setIndex(FL.wg.index);
    if (m.scan) { // the thinned trunk that casts the shadow is drawn in a little, so it never shades the full trunk it stands inside
      const p0 = cw.attributes.position.array, na = cw.attributes.normal, n0 = na.array, ns = na.itemSize, nk = na.normalized ? 1 / 127 : 1, p1 = new Float32Array(p0.length); for (let v = 0; v < p0.length / 3; v++) for (let c = 0; c < 3; c++) p1[v * 3 + c] = p0[v * 3 + c] - n0[v * ns + c] * nk * 0.022; cw.setAttribute('position', new THREE.BufferAttribute(p1, 3)); }   // (the normals are 8-bit, four to a vertex, in the round-16 file)
    const castWood = new THREE.InstancedMesh(cw, woodMats[m.spec.bark], cap), castCrown = new THREE.InstancedMesh(m.proxy, proxyMat, cap);
    castWood.instanceMatrix.setUsage(THREE.DynamicDrawUsage); castCrown.instanceMatrix = castWood.instanceMatrix;
    const nW = FL.wcount, w0 = FL.wstart, nP = m.proxy.index.count;
    castWood.onBeforeRender = (r, sc, cam, g) => { g.setDrawRange(0, 0); }; castWood.onBeforeShadow = (r, o, cam, sc, g) => { g.setDrawRange(w0, nW); };
    castCrown.onBeforeRender = (r, sc, cam, g) => { g.setDrawRange(0, 0); }; castCrown.onBeforeShadow = (r, o, cam, sc, g) => { g.setDrawRange(0, nP); };
    // round 33: with the trunk's shadow drawn on the paving (TSHADOW) the trunk stays out of the shadow map up to just under its fork (?tsh= cap, metres of the model), so the near, dark part of its shadow is the exact one and not the map's stipple
    m.thk = TSHADOW ? Math.max(1.5, Math.min(qnum('tsh', 1.5), 0.85 * (m.scan ? (scan.q.crown0 || 1.5) : (m.info.forkH || 1.5)))) : 1.5; (tm.thk = tm.thk || []).push(+m.thk.toFixed(2));
    if (m.sp !== 'planeBig' && m.sp !== 'broad') {   // the lowest 1.5 m of a street tree's trunk stays out of the shadow map: its shadow there is the computed one
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      dm.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying float vTY;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vTY = position.y;'); sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying float vTY;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vTY < ' + m.thk.toFixed(2) + ') discard;'); };
      dm.customProgramCacheKey = () => 'stTreeWoodDepth1_' + m.thk.toFixed(2); castWood.customDepthMaterial = dm;
    }
    castCrown.customDepthMaterial = proxyDepth;
    for (const o of [castWood, castCrown]) { Object.assign(o, { frustumCulled: false, castShadow: true, receiveShadow: false, count: 0, matrixAutoUpdate: false }); o.userData.kind = 'st_treecast'; group.add(o); }
    m.castWood = castWood; m.castCrown = castCrown; m.castTris = nW / 3 + nP / 3;
  }
  const NI = trees.length, ig = new THREE.InstancedBufferGeometry();
  ig.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3)); ig.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); ig.setIndex([0, 1, 2, 0, 2, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(NI * 3), 3), iA = new THREE.InstancedBufferAttribute(new Float32Array(NI * 4), 4), iB = new THREE.InstancedBufferAttribute(new Float32Array(NI * 2), 2), iTint = new THREE.InstancedBufferAttribute(new Float32Array(NI * 3), 3);
  for (const a of [iPos, iA, iB, iTint]) a.setUsage(THREE.DynamicDrawUsage);
  ig.setAttribute('iPos', iPos); ig.setAttribute('iA', iA); ig.setAttribute('iB', iB); ig.setAttribute('iTint', iTint); ig.instanceCount = 0;
  const impostors = new THREE.Mesh(ig, impMat); Object.assign(impostors, { frustumCulled: false, castShadow: false, receiveShadow: true, matrixAutoUpdate: false }); impostors.userData.kind = 'st_treeimp'; group.add(impostors);
  const opt = {};
  const frustum = new THREE.Frustum(), PM = new THREE.Matrix4(), sph = new THREE.Sphere(), last = { p: new THREE.Vector3(1e9, 0, 0), q: new THREE.Quaternion(), fov: 0 };
  const stats = { shown: [0, 0, 0], tris: 0, shadowTris: 0, casters: 0 };
  function update(force) {
    const cam = world.camera; cam.updateMatrixWorld();
    if (!force && last.p.distanceToSquared(cam.position) < 0.04 && Math.abs(last.q.dot(cam.quaternion)) > 0.99999 && last.fov === cam.fov) return;
    last.p.copy(cam.position); last.q.copy(cam.quaternion); last.fov = cam.fov;
    PM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(PM);
    const cx = cam.position.x, cz = cam.position.z, zoom = Math.tan(27 * Math.PI / 180) / Math.tan(cam.fov * Math.PI / 360); ZOOMK.value = 1 / Math.max(1, zoom * 0.85);
    const castR = shared.uShadowFar.value * 0.75 + 14;                 // past this the shadow map has faded into the bake
    stats.shown = [0, 0, 0]; stats.tris = 0; stats.shadowTris = 0; stats.casters = 0;
    let ni = 0;
    for (const m of models) {
      const nb = m.nb, n = new Array(nb).fill(0), nl = new Array(nb).fill(0); let nf = 0, nc = 0;
      for (const t of m.trees) {
        const dx = t.x - cx, dz = -t.y - cz, d = Math.hypot(dx, dz);
        if (d < castR) m.castWood.instanceMatrix.array.set(t.m, nc++ * 16);
        sph.center.set(t.x, t.cy || 7 * t.f, -t.y); sph.radius = t.rad + 3; if (!frustum.intersectsSphere(sph)) continue;
        const de = d / Math.max(1, zoom * 0.85); let crownIn = true; if (m.scan) crownIn = frustum.intersectsBox(t.crB);
        const put = (l) => { const ms = m.meshes[l], i = n[l]++; ms.wood.instanceMatrix.array.set(t.m, i * 16); if (!m.scan) { ms.leaf.instanceColor.array.set(t.c, i * 3); nl[l] = n[l]; } else if (crownIn) { const j = nl[l]++; ms.leaf.instanceMatrix.array.set(t.m, j * 16); ms.leaf.instanceColor.array.set(t.c, j * 3); } };
        if (m.lods[0].rng) { let any = false;   // bands that overlap: a tree inside an overlap is drawn in both, each band showing its share of the pieces
          for (let l = 0; l < nb; l++) { const rg = m.lods[l].rng; if (de >= rg[0] && de < Math.min(rg[1], m.lodD[nb - 1])) { put(l); any = true; } }
          if (any) continue; }
        else if (de < m.lodD[nb - 1]) { let l = 0; while (de >= m.lodD[l]) l++; put(l); continue; }
        m.farWood.instanceMatrix.array.set(t.m, nf++ * 16);
        const I = m.imp; iPos.array[ni * 3] = t.x; iPos.array[ni * 3 + 1] = 0.15; iPos.array[ni * 3 + 2] = -t.y;
        iA.array[ni * 4] = t.yaw; iA.array[ni * 4 + 1] = m.id; iA.array[ni * 4 + 2] = I.R * t.sc[0]; iA.array[ni * 4 + 3] = I.R * t.sc[2];
        iB.array[ni * 2] = I.y0 * t.sc[1]; iB.array[ni * 2 + 1] = I.y1 * t.sc[1]; iTint.array.set(t.c, ni * 3); ni++;
      }
      for (let l = 0; l < nb; l++) {
        const ms = m.meshes[l]; ms.wood.count = n[l]; ms.leaf.count = nl[l]; if (ms.fr) { ms.fr.count = nl[l]; ms.fr.visible = nl[l] > 0; } ms.foot.count = V2 ? 0 : n[l]; ms.wood.visible = n[l] > 0; ms.leaf.visible = nl[l] > 0; if (m.scan && nl[l]) ms.leaf.instanceMatrix.needsUpdate = true; ms.foot.visible = !V2 && n[l] > 0; if (ms.bw) { ms.bw.count = n[l]; ms.bw.visible = n[l] > 0; }
        if (n[l]) { ms.wood.instanceMatrix.needsUpdate = true; ms.leaf.instanceColor.needsUpdate = true; }
        stats.shown[Math.min(l, 1)] += n[l]; stats.tris += n[l] * (m.lods[l].tris + (V2 ? 0 : m.foot.tris));
      }
      m.farWood.count = nf; m.farWood.visible = nf > 0; if (nf) m.farWood.instanceMatrix.needsUpdate = true; stats.shown[2] += nf; stats.tris += nf * (m.lods[nb].wcount / 3 + 2);
      m.castWood.count = m.castCrown.count = nc; m.castWood.visible = m.castCrown.visible = nc > 0; if (nc) m.castWood.instanceMatrix.needsUpdate = true; stats.casters += nc; stats.shadowTris += nc * m.castTris;
    }
    ig.instanceCount = ni; impostors.visible = ni > 0; if (ni) { iPos.needsUpdate = iA.needsUpdate = iB.needsUpdate = iTint.needsUpdate = true; }
  }
  const render0 = world.render.bind(world);
  world.render = (t, focus) => { PROJ.value = world.camera.projectionMatrix; update(false); return render0(t, focus); };
  PROJ.value = world.camera.projectionMatrix; update(true);

  mark('bands');
  // ---- pits and guards: static, per map tile
  const pitMat = pitMaterial(shared, soilC, soilN), pitMatHero = pitMaterial(shared, soilC, soilN, { chips: chipsC, chipsN, disp: chipsD, dirt: dirtC, dirtN });
  const sizes = [[1.5, 1.45], [2.3, 1.45], [3.0, 1.45]];
  const pitG = sizes.map((s, i) => [['granite', false], ['cobble', false], ['granite', true], ['cobble', true]].map(([rim, pl], v) => pitGeometry(s[0], s[1], 7 + i * 5 + v * 13, rim, pl))
    .concat([['flush', false], ['flush', false], ['flush', true], ['flush', true]].map(([rim, pl], v) => pitGeometry(s[0], s[1], 7 + i * 5 + v * 13 + 3, rim, pl, true))));
  const guardG = sizes.map((s, i) => [guardGeometry(s[0], s[1], 'rail', 31 + i), guardGeometry(s[0], s[1], 'hoop', 47 + i)]);
  for (const gs of guardG) for (const g of gs) { const n = g.attributes.position.count; g.setAttribute('aDry', new THREE.Float32BufferAttribute(new Float32Array(n).fill(-1), 1)); g.setAttribute('aLift', new THREE.Float32BufferAttribute(new Float32Array(n), 1)); }
  const TT = 48, tiles = new Map(), pitTiles = [], flat = [], sunk = sizes.map(() => []), sunkCity = new Map(); let nPit = 0, nGuard = 0, pitTris = 0;
  const tsh = [];
  for (const t of trees) {
    if (t.park || t.skip || t.onGrass) continue;
    const r = (k) => h2(t.x, t.y, 20 + k);
    const si = t.pk < 2.4 ? 0 : t.model.sp === 'plane' ? (r(1) < 0.5 ? 2 : 1) : (r(1) < 0.35 ? 0 : r(1) < 0.8 ? 1 : 2);
    // most pits have a guard; four in ten guarded pits are planted; the rim is a granite kerb or a row of setts
    const guard = t.hero ? t.hero.guard : r(2) < 0.62, planted = guard && r(4) < 0.4, v = (r(3) < 0.55 ? 0 : 1) + (planted ? 2 : 0) + (t.hero ? 4 : 0);
    const k = Math.floor(t.x / TT) + ',' + Math.floor(t.y / TT); let tile = tiles.get(k);
    if (!tile) tiles.set(k, tile = { p: sizes.map(() => [[], [], [], [], [], [], [], []]), g: sizes.map(() => [[], []]), a: sizes.map(() => []) });
    let back = Math.max(0, sizes[si][1] / 2 + 0.06 - t.kerb);              // keep the pit on the sidewalk side of the kerb
    if (t.pk < 1.1) { const l = Math.hypot(t.pkv[0], t.pkv[1]) || 1, pkz = (t.pkv[0] * Math.sin(t.kh) - t.pkv[1] * Math.cos(t.kh)) / l; back = Math.max(-0.3, Math.min(0.3, back + (1.1 - t.pk) * pkz)); }   // and on the paved side of a park's edge
    E.set(0, t.kh, 0); Q2.setFromEuler(E); P.set(t.x - Math.sin(t.kh) * back, 0.15, -t.y - Math.cos(t.kh) * back); Sc.set(1, 1, 1); M.compose(P, Q2, Sc);
    const mm = M.clone(); mm.pit = [t.R, back, r(6), guard ? sizes[si][0] / 2 - 0.06 : 0]; mm.kerb = Math.min(9, t.kerb + back); mm.kh = t.kh; mm.si = si; if (TSHADOW && t.sc) tsh.push([mm, t]); if (t.hero && V2) sunk[si].push(mm); else if (PITALL && V2 && r(3) < 0.55) { let sc = sunkCity.get(k); if (!sc) sunkCity.set(k, sc = sizes.map(() => [])); sc[si].push(mm); } else { tile.p[si][v].push(mm); flat.push([mm, si]); tile.a[si].push(mm); } if (guard) tile.g[si][r(5) < 0.5 ? 0 : 1].push(M.clone());
    if (guard && game.statics && game.statics.addSeg && !/[?&]guardsolid=0/.test(location.search)) {   // round 28 (ITEM12 'Added 18:30'): a guard is a low iron fence on three sides (open to the kerb): nobody walks through it
      const gx = sizes[si][0] / 2 - 0.06, gz = sizes[si][1] / 2 - 0.06, e = M.elements, W = (lx, lz) => [e[0] * lx + e[8] * lz + e[12], -(e[2] * lx + e[10] * lz + e[14])];
      const a0 = W(-gx, gz), a1 = W(-gx, -gz), a2 = W(gx, -gz), a3 = W(gx, gz); game.statics.addSeg(a0[0], a0[1], a1[0], a1[1]); game.statics.addSeg(a1[0], a1[1], a2[0], a2[1]); game.statics.addSeg(a2[0], a2[1], a3[0], a3[1]); }
  }
  const apronG = sizes.map((s, i) => apronGeometry(s[0], s[1], 91 + i)), apronMat = apronMaterial(shared);
  for (const [, tile] of tiles) for (let si = 0; si < 3; si++) {
    if (tile.a[si].length) { const ag = new THREE.BufferGeometry(); for (const k in apronG[si].attributes) ag.setAttribute(k, apronG[si].attributes[k]); ag.setIndex(apronG[si].index);
      const ap = new Float32Array(tile.a[si].length * 4); tile.a[si].forEach((mm, i) => ap.set(mm.pit, i * 4)); ag.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4));
      const im = new THREE.InstancedMesh(ag, apronMat, tile.a[si].length); im.renderOrder = 6; im.onBeforeRender = (r, sc, cam, g, mat) => { g.setDrawRange(0, mat === apronMat ? Infinity : 0); }; tile.a[si].forEach((mm, i) => im.setMatrixAt(i, mm)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.receiveShadow = true; im.userData.kind = 'st_treeapron'; group.add(im); pitTiles.push(im); }
    const sets = [0, 1, 2, 3, 4, 5, 6, 7].map((v) => [tile.p[si][v], pitG[si][v], false, v >= 4]).concat([0, 1].map((v) => [tile.g[si][v], guardG[si][v], true, false]));
    for (const [list, geo, cast, heroPit] of sets) {
      if (!list.length) continue;
      let g2 = geo;
      if (!cast) { g2 = new THREE.BufferGeometry(); for (const k in geo.attributes) g2.setAttribute(k, geo.attributes[k]); g2.setIndex(geo.index);
        const ap = new Float32Array(list.length * 4); list.forEach((mm, i) => ap.set(mm.pit, i * 4)); g2.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4)); }
      const im = new THREE.InstancedMesh(g2, heroPit ? pitMatHero : pitMat, list.length); list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.castShadow = false; im.receiveShadow = true; im.userData.kind = cast ? 'st_treeguard' : 'st_treepit';
      group.add(im); pitTiles.push(im); if (cast) nGuard += list.length; else nPit += list.length;
      pitTris += list.length * (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    }
  }
  if (V2) { const sm = sunkPitMaterial(shared, { chips: chipsC, chipsN, disp: chipsD }), chipMat = chipsMaterial(shared), spillMat = spillMaterial(shared, { chips: chipsC, chipsN, disp: chipsD }), bedMat = chipBedMaterial(shared, { chips: chipsC });

    sizes.forEach((sz, si) => { const sets = (sunk[si].length ? [sunk[si]] : []).concat([...sunkCity.values()].map((sc) => sc[si]).filter((l) => l.length)); if (!sets.length) return;   // the hole itself is one mesh for the city (two triangles a pit); what only a near pit shows (spill, chips) is one mesh per set: the hero blocks' pits, then each 48 m tile's
      const list = [].concat(...sets);
      const hx = sz[0] / 2, hz = sz[1] / 2, mx = hx + 0.12, mz = hz + 0.12, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-mx, 0.007, -mz, -mx, 0.007, mz, mx, 0.007, mz, mx, 0.007, -mz], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('aHalf', new THREE.Float32BufferAttribute([hx, hz, hx, hz, hx, hz, hx, hz], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
      const ap = new Float32Array(list.length * 4); list.forEach((mm, i) => ap.set(mm.pit, i * 4)); g.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4));
      g.setAttribute('aKerb', new THREE.InstancedBufferAttribute(new Float32Array(list.map((mm) => mm.kerb)), 1));
      const im = new THREE.InstancedMesh(g, sm, list.length); list.forEach((mm, i) => im.setMatrixAt(i, mm)); im.instanceMatrix.needsUpdate = true;
      Object.assign(im, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 3 }); im.userData.kind = 'st_treepit'; group.add(im); nPit += list.length; pitTris += list.length * 2;
      { const sx = hx + 0.45, sz2 = hz + 0.45, sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute([-sx, 0.009, -sz2, -sx, 0.009, sz2, sx, 0.009, sz2, sx, 0.009, -sz2], 3)); sg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
        sg.setAttribute('aHalf', new THREE.Float32BufferAttribute([hx, hz, hx, hz, hx, hz, hx, hz], 2)); sg.setIndex([0, 1, 2, 0, 2, 3]); sg.setAttribute('aPit', g.attributes.aPit); sg.setAttribute('aKerb', g.attributes.aKerb);
        for (const ls of sets) { if (ls !== sunk[si]) continue; const sgi = sets.length === 1 ? sg : new THREE.BufferGeometry(); if (sgi !== sg) { for (const k of ['position', 'normal', 'aHalf']) sgi.setAttribute(k, sg.attributes[k]); sgi.setIndex(sg.index); const api = new Float32Array(ls.length * 4); ls.forEach((mm, i) => api.set(mm.pit, i * 4)); sgi.setAttribute('aPit', new THREE.InstancedBufferAttribute(api, 4)); sgi.setAttribute('aKerb', new THREE.InstancedBufferAttribute(new Float32Array(ls.map((mm) => mm.kerb)), 1)); }
        const sp = new THREE.InstancedMesh(sgi, spillMat, ls.length); if (sets.length === 1) sp.instanceMatrix = im.instanceMatrix; else { ls.forEach((mm, i) => sp.setMatrixAt(i, mm)); sp.instanceMatrix.needsUpdate = true; }
        Object.assign(sp, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 3 }); sp.userData.kind = 'st_treepit'; sp.userData.near = ls; sp.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); group.add(sp); pitTiles.push(sp); pitTris += ls.length * 2; } }
      if (BED) { const bg = chipBedGeometry(sz[0], sz[1], 811 + si * 7); bg.setAttribute('aPit', g.attributes.aPit); bg.setAttribute('aKerb', g.attributes.aKerb);
        { const n = bg.attributes.position.count, hh = new Float32Array(n * 2); for (let q = 0; q < n; q++) { hh[q * 2] = hx; hh[q * 2 + 1] = hz; } bg.setAttribute('aHalf', new THREE.BufferAttribute(hh, 2)); }
        // one mesh per pit (the same vertex buffers), so only the pits within a few metres are drawn
        list.forEach((mm, i) => { const gi = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'color', 'aChip', 'aCuv', 'aHalf']) gi.setAttribute(k, bg.attributes[k]); gi.setIndex(bg.index);
          gi.setAttribute('aPit', new THREE.InstancedBufferAttribute(new Float32Array(mm.pit), 4)); gi.setAttribute('aKerb', new THREE.InstancedBufferAttribute(new Float32Array([mm.kerb]), 1));
          const bed = new THREE.InstancedMesh(gi, bedMat, 1); bed.setMatrixAt(0, mm); bed.instanceMatrix.needsUpdate = true;
          Object.assign(bed, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 6 }); bed.userData.kind = 'st_treepit'; bed.userData.near = [mm]; bed.userData.nearD = 9; bed.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); group.add(bed); pitTiles.push(bed); });
        pitTris += bg.index.count / 3; }
      if (EDGE) { const th = 0.007, up = 0.022, dn = 0.05, P = [], I = []; const bar = (x0, z0, x1, z1) => { const o = P.length / 3; for (const y of [-dn, up]) P.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1); I.push(o + 4, o + 6, o + 5, o + 4, o + 7, o + 6); for (let q = 0; q < 4; q++) { const n = (q + 1) % 4; I.push(o + q, o + 4 + q, o + 4 + n, o + q, o + 4 + n, o + n); } };
        bar(-hx - th, -hz - th, hx + th, -hz); bar(-hx - th, hz, hx + th, hz + th); bar(-hx - th, -hz, -hx, hz); bar(hx, -hz, hx + th, hz);
        const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); eg.setIndex(I); const eg2 = eg.toNonIndexed(); eg2.computeVertexNormals();
        const em = new THREE.MeshStandardMaterial({ color: 0x2a1f19, roughness: 0.85, metalness: 0.35 }); const ed = new THREE.InstancedMesh(eg2, em, list.length); list.forEach((mm, i) => ed.setMatrixAt(i, mm)); ed.instanceMatrix.needsUpdate = true;
        Object.assign(ed, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 6 }); ed.userData.kind = 'st_treepit'; ed.userData.near = list; ed.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); group.add(ed); pitTiles.push(ed); }
      // drawn after the hole: the loose chips; then the hole is closed again in the depth buffer at paving level, so nothing drawn later falls into it
      const cg = chipsGeometry(sz[0], sz[1], 301 + si); cg.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4)); { const n = cg.attributes.position.count, hh = new Float32Array(n * 2); for (let q = 0; q < n; q++) { hh[q * 2] = hx; hh[q * 2 + 1] = hz; } cg.setAttribute('aHalf', new THREE.BufferAttribute(hh, 2)); }
      if (!cg.index.count) return;
      for (const ls of sets) { const cgi = sets.length === 1 ? cg : new THREE.BufferGeometry(); if (cgi !== cg) { for (const k in cg.attributes) if (k !== 'aPit') cgi.setAttribute(k, cg.attributes[k]); cgi.setIndex(cg.index); const api = new Float32Array(ls.length * 4); ls.forEach((mm, i) => api.set(mm.pit, i * 4)); cgi.setAttribute('aPit', new THREE.InstancedBufferAttribute(api, 4)); }
      const ch = new THREE.InstancedMesh(cgi, chipMat, ls.length); if (sets.length === 1) ch.instanceMatrix = im.instanceMatrix; else { ls.forEach((mm, i) => ch.setMatrixAt(i, mm)); ch.instanceMatrix.needsUpdate = true; } Object.assign(ch, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 4 }); ch.userData.kind = 'st_treepit'; group.add(ch); pitTiles.push(ch); ch.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); ch.userData.near = ls; ch.userData.nearD = 12;   // round 28: the real pieces are drawn only for pits within 12 m (they are a few pixels beyond)
pitTris += ls.length * cg.index.count / 3; } }); }
  // round 33: the trunk's own shadow on the paving. One mesh for the city: a square of paving round each street trunk, drawn as a multiply
  // over what is there, only where the shadow map says the sun reaches (so never doubled inside another shadow), not inside the pit (the
  // mulch draws its own), not past the kerb, gone by 52 m. Same strip as the pit's (radius, penumbra), ending where the shadow map's trunk begins.
  if (TSHADOW && tsh.length) {
    const n = tsh.length, pos = new Float32Array(n * 12), aL = new Float32Array(n * 8), aT = new Float32Array(n * 16), aH = new Float32Array(n * 12), idx = new Uint32Array(n * 6);
    const sdv = world.sunDir, tanEl = Math.max(0.15, sdv.y / Math.max(0.05, Math.hypot(sdv.x, sdv.z)));
    tsh.forEach(([mm, t], i) => { const kh = mm.kh, c = Math.cos(kh), sn = Math.sin(kh), back = mm.pit[1], hTop = (t.model.thk || 1.5) * t.sc[1], half = Math.min(6, hTop / tanEl + 0.7), cx = mm.elements[12], cz = mm.elements[14];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => { const lx = u * half, lz = back + v * half, o = i * 4 + k;
        pos[o * 3] = cx + c * lx + sn * lz; pos[o * 3 + 1] = 0.156; pos[o * 3 + 2] = cz - sn * lx + c * lz; aL[o * 2] = lx; aL[o * 2 + 1] = lz;
        aT.set([mm.pit[0], back, hTop, kh], o * 4); aH.set([sizes[mm.si][0] / 2, sizes[mm.si][1] / 2, mm.kerb - 0.03], o * 3); });
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aL', new THREE.BufferAttribute(aL, 2)); g.setAttribute('aT', new THREE.BufferAttribute(aT, 4)); g.setAttribute('aH', new THREE.BufferAttribute(aH, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const k0 = qnum('tsk', 0.18), sm = new THREE.ShadowMaterial({ transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, side: THREE.DoubleSide, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    sm.onBeforeCompile = (sh) => { sh.uniforms.uSunDir = shared.uSunDir; sh.uniforms.uTSK = { value: new THREE.Vector3(k0, k0 * 1.04, k0 * 1.2) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec2 aL; attribute vec4 aT; attribute vec3 aH; varying vec2 vL; varying vec4 vT; varying vec3 vH; varying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vL = aL; vT = aT; vH = aH; vWP = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n uniform vec3 uSunDir; uniform vec3 uTSK; varying vec2 vL; varying vec4 vT; varying vec3 vH; varying vec3 vWP;').replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', `
        if ((abs(vL.x) < vH.x - 0.015 && abs(vL.y) < vH.y - 0.015) || vL.y > vH.z) discard;
        float tc = cos(vT.w), ts = sin(vT.w), tsh = 0.0; vec2 sl = vec2(tc * uSunDir.x - ts * uSunDir.z, ts * uSunDir.x + tc * uSunDir.z); float hl = length(sl);
        if (hl > 0.05 && uSunDir.y > 0.08) { vec2 sd = -sl / hl, rel = vL - vec2(0.0, vT.y); float al = dot(rel, sd), ac = abs(dot(rel, vec2(-sd.y, sd.x))), R = vT.x * 1.15, len = vT.z * hl / uSunDir.y;
          tsh = smoothstep(-0.01, 0.02, al) * (1.0 - smoothstep(R, R + 0.01 + 0.03 * al, ac)) * (1.0 - smoothstep(len * 0.80, len * 1.02, al)); }
        tsh *= 1.0 - smoothstep(38.0, 52.0, distance(vWP, cameraPosition));
        if (tsh < 0.004) discard;
        tsh *= getShadowMask();
        gl_FragColor = vec4(mix(vec3(1.0), uTSK, tsh), 1.0);`); };
    sm.customProgramCacheKey = () => 'stTrunkShadow1';
    const tm2 = new THREE.Mesh(g, sm); Object.assign(tm2, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 3 }); tm2.userData.kind = 'st_treepit'; group.add(tm2);
  }
  // for the sidewalks part (items/trees/ASK.md): the hero pits as rectangles in map metres, [x, y, heading, length along the kerb, width]
  game.heroPits = [].concat(...sunk).map((mm) => [+mm.elements[12].toFixed(2), +(-mm.elements[14]).toFixed(2), +mm.kh.toFixed(3), sizes[mm.si][0], sizes[mm.si][1]]);
  if (V2 && typeof location !== 'undefined' && /[?&]pitdump=1/.test(location.search)) console.log('[game] trees hero pits [x, y, heading, length, width] ' + JSON.stringify([].concat(...sunk).map((mm) => [+mm.elements[12].toFixed(2), +(-mm.elements[14]).toFixed(2), +mm.kh.toFixed(3), sizes[mm.si][0], sizes[mm.si][1]])));
  if (V2) { const mg0 = moundGeometry(), mdMat = moundMaterial(shared, { chips: chipsC, chipsN, disp: chipsD }); for (const all of [[].concat(...sunk)]) if (all.length) {   // (the generated trunks of the city pits bring their own root flare: no mound heaped against them)
      const mg = new THREE.BufferGeometry(); for (const k in mg0.attributes) mg.setAttribute(k, mg0.attributes[k]); mg.setIndex(mg0.index); const ap = new Float32Array(all.length * 4); all.forEach((mm, i) => ap.set(mm.pit, i * 4)); mg.setAttribute('aPit', new THREE.InstancedBufferAttribute(ap, 4));
      const md = new THREE.InstancedMesh(mg, mdMat, all.length); all.forEach((mm, i) => md.setMatrixAt(i, mm)); md.instanceMatrix.needsUpdate = true;
      Object.assign(md, { frustumCulled: false, matrixAutoUpdate: false, castShadow: false, receiveShadow: true, renderOrder: 5 }); md.userData.kind = 'st_treepit'; md.userData.near = all; md.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9); group.add(md); pitTiles.push(md); } }
  // every pit is also a plain dark patch (two triangles, one draw call for the city), which is all that is drawn of it past ~46 m
  { const fg = new THREE.PlaneGeometry(1, 1); fg.rotateX(-Math.PI / 2); const fm = new THREE.MeshStandardMaterial({ color: 0x241d17, roughness: 1, metalness: 0 }); fm.polygonOffset = true; fm.polygonOffsetFactor = -1; fm.polygonOffsetUnits = -1;
    const fi = new THREE.InstancedMesh(fg, fm, Math.max(1, flat.length)), m4 = new THREE.Matrix4(), sc = new THREE.Matrix4();
    flat.forEach(([mm, si], i) => { sc.makeScale(sizes[si][0] - 0.2, 1, sizes[si][1] - 0.2); sc.elements[13] = 0.012; m4.multiplyMatrices(mm, sc); fi.setMatrixAt(i, m4); });
    fi.count = flat.length; fi.instanceMatrix.needsUpdate = true; fi.frustumCulled = false; fi.matrixAutoUpdate = false; fi.castShadow = false; fi.receiveShadow = true; fi.userData.kind = 'st_treepitfar'; group.add(fi); }
  // pits are small things: beyond 230 m their tiles are not drawn
  const render1 = world.render; world.render = (t, focus) => { const c = world.camera.position; for (const im of pitTiles) { if (im.userData.near) { let near = false; for (const mm of im.userData.near) if (Math.hypot(mm.elements[12] - c.x, mm.elements[14] - c.z) < (im.userData.nearD || 30)) { near = true; break; } im.visible = near; continue; } const b = im.boundingSphere; im.visible = Math.hypot(b.center.x - c.x, b.center.z - c.z) - b.radius < 46; } return render1(t, focus); };

  mark('pits');
  tm.gen_workers = nGenW;
  const report = { tm, instances: trees.length, hero_census: nHero, hero_dropped: nDropped, circles_moved: nCirc, models: models.length, pits: nPit, guards: nGuard, pit_ktris_city: Math.round(pitTris / 1000),
    get ktris() { return Math.round(stats.tris / 1000); }, get shadow_ktris() { return Math.round(stats.shadowTris / 1000); }, get casters() { return stats.casters; }, get bands() { return stats.shown.join('/'); },
    model_ktris: models.map((m) => m.sp[0] + m.sp.slice(-1) + ':' + m.lods.slice(0, m.nb).map((l) => l.tris).concat([m.lods[m.nb].wcount / 3 + 2, m.castTris]).map((v) => Math.round(v / 100) / 10).join('/')).join(' ') };
  return { group, report, update, stats, trees, models, opt, leafMat, impostors };
}
