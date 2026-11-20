// park/cards.js (park lane): the far form of a park tree = three crossed upright cards carrying a PAINTED tree (made here on a canvas, nothing
// fetched): a branching skeleton that forks down to fine twigs; a leafed tree gets clumps of leaf dabs on its outer twigs (light on top of a clump,
// dark under it, sky between the clumps: a November crown that has dropped part of its leaves), a bare tree is the twig mass itself with a few
// last leaves. Leafed cells are grey (the tree's November colour is the instance colour); bare cells are in their own colours.
// One atlas, 4 x 2 cells of 512 px: row 0 leafed (dense .. thin), row 1 bare. `?parkcards=0` gives the old dithered crown shells (trees.js).
import * as THREE from 'three';
import { lit, breathe } from './mat.js';

const CELL = 512, COLS = 4, ROWS = 2;
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// one tree into the cell whose top-left corner is (cx, cy). dens = 0: bare.
function paint(g, cx, cy, seed, dens) {
  const R = rng(seed), segs = [], tips = [], DMAX = dens > 0 ? 7 : 9;
  const grow = (x, y, a, len, w, d) => {
    const a2 = a + (R() - 0.5) * 0.3, x1 = x + Math.sin(a2) * len, y1 = y - Math.cos(a2) * len; segs.push([x, y, x1, y1, w, d]);
    if (d >= 5) tips.push([x1, y1, d]);
    if (d >= DMAX || len < 3) return;
    const n = d === 0 ? 3 : (R() < 0.32 ? 3 : 2);
    for (let k = 0; k < n; k++) { let na = a2 + (k - (n - 1) / 2) * (0.6 + R() * 0.35) + (R() - 0.5) * 0.4; na = Math.max(-1.8, Math.min(1.8, na * 0.96));
      grow(x1, y1, na, len * (0.66 + R() * 0.18), Math.max(0.75, w * 0.62), d + 1); }
  };
  grow(0, 0, (R() - 0.5) * 0.08, 100, 13, 0);
  // fit the skeleton to the cell: the crown's half width = 0.46 of the cell, the top 0.02 under the cell's top, the foot on its bottom edge
  let xa = 0, ya = 0; for (const s of segs) { xa = Math.max(xa, Math.abs(s[2])); ya = Math.min(ya, s[3]); }
  const pad = dens > 0 ? 26 : 4, fx = (CELL * 0.46 - pad) / (xa || 1), fy = (CELL * 0.97 - pad) / (-ya || 1), X = (x) => cx + CELL / 2 + x * fx, Y = (y) => cy + CELL + y * fy;
  g.save(); g.beginPath(); g.rect(cx + 2, cy + 2, CELL - 4, CELL - 4); g.clip(); g.lineCap = 'round';
  for (const s of segs) { const d = s[5], w = s[4] * Math.min(1, (fx + fy) / 2.4), v = dens > 0 ? 74 : 56 + d * 3 + ((R() * 14) | 0);
    g.strokeStyle = dens > 0 ? `rgb(${v},${v - 6},${v - 12})` : `rgb(${v + 6},${v},${v - 5})`; g.lineWidth = Math.max(d >= 7 ? 0.9 : 1.1, w); g.globalAlpha = d >= 8 ? 0.8 : 1;
    g.beginPath(); g.moveTo(X(s[0]), Y(s[1])); g.lineTo(X(s[2]), Y(s[3])); g.stroke(); }
  g.globalAlpha = 1;
  if (dens > 0) {
    const cl = []; for (const t of tips) if (R() < dens) cl.push([X(t[0]) + (R() - 0.5) * 10, Y(t[1]) + (R() - 0.5) * 10, 11 + R() * 17]);
    const dab = (x, y, r, v) => { g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.ellipse(x, y, r, r * (0.55 + R() * 0.4), R() * 3.1, 0, 6.2832); g.fill(); };
    for (const c of cl) for (let k = 0; k < 7; k++) { const a = R() * 6.2832, q = Math.sqrt(R()) * c[2]; dab(c[0] + Math.cos(a) * q, c[1] + Math.sin(a) * q * 0.7 + c[2] * 0.3, 2.5 + R() * 3.2, 88 + ((R() * 44) | 0)); }      // the underside of each clump: in its own shade
    for (const c of cl) for (let k = 0; k < 11; k++) { const a = R() * 6.2832, q = Math.sqrt(R()) * c[2], dy = Math.sin(a) * q * 0.7, up = 0.5 - dy / (c[2] * 1.4);
      dab(c[0] + Math.cos(a) * q, c[1] + dy, 2.0 + R() * 3.0, Math.min(255, 140 + ((up * 95 + R() * 36) | 0))); }
  } else {
    for (const t of tips) if (t[2] >= 7 && R() < 0.05) { g.fillStyle = R() < 0.5 ? 'rgb(150,104,44)' : 'rgb(128,76,36)'; g.beginPath(); g.ellipse(X(t[0]), Y(t[1]), 1.8 + R() * 1.4, 1.3, R() * 3, 0, 6.2832); g.fill(); }      // a few last leaves
  }
  g.restore();
}

// makeCards(game) -> { geoLeaf, geoBare, matLeaf, matBare, SX, SY }: unit card sets (x, z in -1..1, y in 0..1) to be scaled by (r * SX, h * SY)
export async function makeCards(game, px) {      // px (trees.js, parkx): { u: the clock uniform, glsl: pkxF() } = a card whose tree has just joined or is leaving the near pool dissolves over 0.9 s
  const cv = document.createElement('canvas'); cv.width = CELL * COLS; cv.height = CELL * ROWS; const g = cv.getContext('2d', { willReadFrequently: true });
  const DENS = [0.5, 0.36, 0.26, 0.17];
  for (let c = 0; c < COLS; c++) { paint(g, c * CELL, 0, 101 + c * 17, DENS[c]); await breathe(); paint(g, c * CELL, CELL, 211 + c * 13, 0); await breathe(); }
  // straight (not premultiplied) pixels; where nothing was painted the colour is set to the mean tone, so the small mips do not darken the outline
  const im = g.getImageData(0, 0, cv.width, cv.height), d = im.data;
  for (let r = 0; r < ROWS; r++) { const fill = r === 0 ? [150, 150, 150] : [70, 63, 58]; for (let y = r * CELL; y < (r + 1) * CELL; y++) for (let x = 0, i = y * cv.width * 4; x < cv.width; x++, i += 4) if (d[i + 3] < 10) { d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 0; } }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer), cv.width, cv.height, THREE.RGBAFormat); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 4; tex.needsUpdate = true;
  // three cards at 60 degrees, each with another cell of its row; data row 0 of the picture is v = 0 (flipY off), so a card's top has the smaller v
  const geo = (row) => { const P = [], N = [], UV = [], I = [];
    for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3 + 0.2, ca = Math.cos(a), sa = Math.sin(a), cell = (k + row) % COLS, u0 = cell / COLS + 0.002, u1 = (cell + 1) / COLS - 0.002, v0 = row / ROWS + 0.004, v1 = (row + 1) / ROWS - 0.002, b = P.length / 3;
      for (const [sx, sy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) { P.push(sx * ca, sy, sx * sa); const nx = sx * ca * 0.8, ny = (sy - 0.45) * 1.1 + 0.55, nz = sx * sa * 0.8, l = Math.hypot(nx, ny, nz); N.push(nx / l, ny / l, nz / l); UV.push(sx < 0 ? u0 : u1, sy ? v0 : v1); }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); ge.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); ge.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); ge.setIndex(I);
    ge.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1.2); ge.userData.shared = true; return ge; };
  // near: the painted edge as it is; far: coverage by a screen dither (a twig mass thins to a haze, it does not vanish with the small mips)
  const PXO = px ? { uniforms: { uPkT: px.u }, vpars: 'uniform float uPkT; varying float vPx; ' + px.glsl, pars: 'varying float vPx;',
    vbody: `vPx = 1.0;
          #ifdef USE_INSTANCING_COLOR
            if (instanceColor.r > 3.0) { bool come_ = instanceColor.r > 7.0; vColor.r = instanceColor.r - (come_ ? 8.0 : 4.0); float f_ = pkxF(instanceColor.g); vColor.g = instanceColor.g - 2.0 * floor(instanceColor.g / 2.0);
              vPx = come_ ? f_ : 1.0 - f_; if (vPx <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
          #endif` } : {};
  const PXB = px ? 'if (vPx < 0.999 && hash21(gl_FragCoord.xy + 0.71) > vPx) discard;\n           ' : '';
  const mat = (key, cutv) => lit(new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 }), game.world.shared, { ...PXO, key: key + (px ? 'x2' : ''), spec: 0, night: 1.8      /* handoff-9: the far crowns' x 0.55 comes back at night (mat.js) */,
    body: PXB + `float dd = distance(cameraPosition, vWPos), hv = hash21(gl_FragCoord.xy + 0.37); pkSide = pkAgainstSun(0.3);      /* look pass k2: no highlight on a twig mass; its far side is in its own shade (mat.js) */
           diffuseColor.a = diffuseColor.a > mix(${cutv}, 0.10 + 0.82 * hv, smoothstep(22.0, 95.0, dd)) ? 1.0 : 0.0;`,
    nbody: 'normal = normalize((viewMatrix * vec4(bakeN, 0.0)).xyz);' });      /* one soft rounded normal for the whole card set, the same from both sides: the tree is lit as a mass */
  console.log('[game] park: tree cards painted ' + cv.width + 'x' + cv.height);
  return { tex, geoLeaf: geo(0), geoBare: geo(1), matLeaf: mat('cardL', '0.45'), matBare: mat('cardB', '0.35'), SX: 1 / 0.90, SY: 1 / 0.97 };
}
