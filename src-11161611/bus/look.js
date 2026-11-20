// look.js (bus lane, model helper): everything that is DRAWN of a bus. Interface: CONTRACT.md. Geometry: look_geo.js (made in code, no download).
// The operator, badge, adverts and every word on the bus are invented ("CITY TRANSIT", a ring-and-bar badge of our own); no real transit marks.
//   near (< 25 m, at most NEAR_CAP buses; the player's own bus always): body with the whole interior, see-through glass, four door leaves
//        that swing, six wheels that spin and steer                                             5 draws
//   mid  (< 120 m): one mesh, dark reflecting glass, wheels and doors part of it                1 draw
//   far: a few hundred triangles                                                                1 draw
// Lit like the streets lane's cars: the game's baked sky/sun/bounce map (facade.js BAKE_LIGHT_GLSL) under three's standard lighting.
import * as THREE from 'three';
import { BAKE_LIGHT_GLSL, NOISE_GLSL } from '../facade.js';
import * as G from './look_geo.js';

// seats: [x, y, z, yaw] hip point and facing. yaw 0 = facing +X (forward); +PI/2 = facing -Z (toward the street side); -PI/2 = facing +Z (the kerb).
//        (so the sitter's forward vector in the model frame is (cos yaw, 0, -sin yaw), the same sense as three's rotation.y)
export const DIMS = {
  len: G.LEN, wid: 2 * G.HW, hgt: G.HGT, wheelbase: G.AXF - G.AXR, radius: G.RADIUS, axF: G.AXF, axR: G.AXR, floor: G.YFL, floorRear: G.YF2,
  doors: { front: { x: G.DOORS.front.x, w: G.DOORS.front.w }, rear: { x: G.DOORS.rear.x, w: G.DOORS.rear.w } }, doorZ: G.HW,
  driver: G.DRIVER, driverEye: [G.DRIVER[0] + 0.02, G.DRIVER[1] + 0.66, G.DRIVER[2]], seats: G.SEATS, eyeAboveHip: 0.66,
  aisle: [[5.02, 1.15], [5.02, 0.42], [4.2, 0.0], [-2.5, 0.0], [-2.5, 1.15], [-2.5, 0.0], [-4.5, 0.0]],     // front door, past the fare box, down the aisle, out to the rear door and back, on to the back seats
  aisleHalf: 0.36, floorAt: G.floorAt, cord: G.CORDS, headroom: 2.78,
};
const NEAR = 25, MID = 120, NEAR_CAP = 4;
const BLUE = '#17358c', GOLD = '#f4b61a', YELLOW = '#f2c010', SKY = '#2f86e0';

// ---------------------------------------------------------------- the 2048 picture: liveries and the cabin's printed things
function paintAtlas() {
  const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 2048, 2048);
  const SANS = '"Helvetica Neue", Helvetica, "Nimbus Sans", "Liberation Sans", Arial, sans-serif';
  const badge = (x, y, r, light) => { g.save(); g.translate(x, y); g.fillStyle = light ? '#fff' : BLUE; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.fillStyle = GOLD; g.beginPath(); g.arc(0, 0, r * 0.72, 0, 7); g.fill();
    g.fillStyle = light ? BLUE : '#fff'; g.rotate(-0.35); g.fillRect(-r * 1.15, -r * 0.2, r * 2.3, r * 0.4); g.restore(); };
  const side = (reg, left) => {
    const [rx, ry, rw, rh] = reg, X = (x) => rx + (left ? (G.XF - x) : (x + G.XF)) / G.LEN * rw, Y = (y) => ry + (1 - y / G.HGT) * rh, sx = rw / G.LEN, sy = rh / G.HGT;
    g.save(); g.beginPath(); g.rect(rx, ry, rw, rh); g.clip();
    g.fillStyle = BLUE; g.fillRect(rx, ry, rw, rh);
    const band = (x0, x1, top, bot, fill) => { g.beginPath(); for (let x = x0; x <= x1 + 1e-6; x += 0.04) g.lineTo(X(x), Y(top(x))); for (let x = x1; x >= x0 - 1e-6; x -= 0.04) g.lineTo(X(x), Y(bot(x))); g.closePath(); g.fillStyle = fill; g.fill(); };
    // the low wave: light blue falling from behind the front wheel to the skirt ahead of the rear wheel, gold under its belly
    const u = (x) => Math.max(0, (x + 2.5) / 5.9), wT = (x) => 0.40 + 0.66 * Math.pow(u(x), 1.25), wB = (x) => 0.36 + 0.40 * Math.pow(u(x), 2.2);
    band(-2.5, 3.4, wT, wB, SKY); band(-2.1, 1.5, wB, (x) => wB(x) - 0.26 * Math.sin(Math.PI * (x + 2.1) / 3.6), GOLD);
    // the high sweep: a gold blade that rises over the front windows onto the roof fairing, light blue under it
    const t = (x) => Math.max(0, (x + 0.6) / 6.6), yc = (x) => 2.47 + 0.50 * t(x) * t(x), th = (x) => 0.015 + 0.20 * Math.pow(t(x), 1.6) * Math.min(1, (6.0 - x) / 0.5);
    band(-0.6, 6.0, (x) => yc(x) + th(x), yc, GOLD); band(0.6, 6.0, yc, (x) => yc(x) - 0.45 * th(x), SKY);
    // the tail: a fan of fine gold lines, then the yellow of the rear wrapping round the corner
    g.strokeStyle = GOLD; g.lineWidth = 0.026 * sy; for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(X(-3.95 - 0.02 * k), Y(0.36 + 0.02 * k)); g.quadraticCurveTo(X(-5.3), Y(0.42 + 0.10 * k), X(-5.86), Y(0.62 + 0.21 * k)); g.stroke(); }
    g.fillStyle = YELLOW; g.fillRect(left ? X(-5.86) : rx, ry, 0.24 * sx, rh);
    const grd = g.createLinearGradient(0, Y(0.9), 0, Y(0.3)); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,10,0.25)'); g.fillStyle = grd; g.fillRect(rx, Y(0.9), rw, Y(0.3) - Y(0.9));
    // panel seams, access doors low on the body, grilles
    g.strokeStyle = 'rgba(0,0,0,0.38)'; g.lineWidth = 1.5;
    for (const x of [-5.4, -4.3, -2.3, -1.2, 0.2, 1.6, 2.9]) { g.beginPath(); g.moveTo(X(x), Y(0.34)); g.lineTo(X(x), Y(1.0)); g.stroke(); }
    g.beginPath(); g.moveTo(X(-5.86), Y(1.0)); g.lineTo(X(4.4), Y(1.0)); g.stroke(); g.beginPath(); g.moveTo(X(-5.86), Y(2.50)); g.lineTo(X(5.6), Y(2.50)); g.stroke(); g.beginPath(); g.moveTo(X(-5.86), Y(2.74)); g.lineTo(X(5.2), Y(2.74)); g.stroke();
    g.fillStyle = '#0c0d10'; g.fillRect(X(left ? -5.33 : -5.75), Y(left ? 2.3 : 1.9), 0.42 * sx, (left ? 1.1 : 0.55) * sy); g.fillStyle = 'rgba(255,255,255,0.10)'; for (let k = 0; k < (left ? 18 : 9); k++) g.fillRect(X(left ? -5.33 : -5.75), Y(left ? 2.3 : 1.9) + k * 0.06 * sy, 0.42 * sx, 1.5);
    if (left) { g.strokeStyle = 'rgba(0,0,0,0.45)'; g.strokeRect(X(-0.6), Y(0.92), 0.42 * sx, 0.34 * sy); }
    // lettering: operator name and badge high at the rear, fleet number high at the front, pictograms by the front door
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.font = `italic 800 ${Math.round(0.125 * sy)}px ${SANS}`;
    g.fillText('CITY TRANSIT', X(-4.2), Y(2.615)); badge(X(-4.2) + (left ? 1 : -1) * -0.78 * sx * (left ? -1 : 1), Y(2.615), 0.075 * sy, true);
    g.font = `700 ${Math.round(0.105 * sy)}px ${SANS}`;
    g.font = `800 ${Math.round(0.13 * sy)}px ${SANS}`; g.fillText('RIDE ◆ NYC', X(0.6), Y(2.615));
    if (!left) { const px = X(4.02), py = Y(1.19), s = 0.15 * sy;
      for (let k = 0; k < 2; k++) { const x0 = px - k * s * 1.2; g.fillStyle = '#2f86e0'; g.fillRect(x0, py, s, s); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = s * 0.09;
        if (k === 0) { g.beginPath(); g.arc(x0 + s * 0.48, py + s * 0.62, s * 0.22, 0.6, 5.2); g.stroke(); g.beginPath(); g.arc(x0 + s * 0.5, py + s * 0.2, s * 0.08, 0, 7); g.fill(); g.beginPath(); g.moveTo(x0 + s * 0.5, py + s * 0.3); g.lineTo(x0 + s * 0.5, py + s * 0.58); g.lineTo(x0 + s * 0.74, py + s * 0.58); g.lineTo(x0 + s * 0.84, py + s * 0.82); g.stroke(); }
        else { g.fillRect(x0 + s * 0.15, py + s * 0.3, s * 0.7, s * 0.3); g.beginPath(); g.moveTo(x0 + s * 0.5, py + s * 0.66); g.lineTo(x0 + s * 0.38, py + s * 0.8); g.lineTo(x0 + s * 0.62, py + s * 0.8); g.fill(); } } }
    g.restore();
  };
  side(G.REG.sideR, false); side(G.REG.sideL, true);
  const face = (reg, rear, sel) => {
    const [rx, ry, rw, rh] = reg, X = (z) => rx + (rear ? (z + G.HW) : (G.HW - z)) / (2 * G.HW) * rw, Y = (y) => ry + (1 - y / G.HGT) * rh, sx = rw / (2 * G.HW), sy = rh / G.HGT;
    g.save(); g.beginPath(); g.rect(rx, ry, rw, rh); g.clip(); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!rear) {
      g.fillStyle = BLUE; g.fillRect(rx, ry, rw, rh);
      if (sel) { g.fillStyle = '#c21a22'; g.fillRect(rx, Y(0.69), rw, 0.07 * sy); g.fillStyle = SKY; g.fillRect(rx, Y(0.62), rw, 0.03 * sy); g.fillStyle = '#fff'; g.font = `italic 900 ${Math.round(0.10 * sy)}px ${SANS}`; g.fillText('+SELECT', rx + rw / 2, Y(0.655)); }
      badge(rx + rw / 2, Y(0.86), 0.07 * sy, true);
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(rx, Y(0.64)); g.lineTo(rx + rw, Y(0.64)); g.stroke();
    } else {
      g.fillStyle = YELLOW; g.fillRect(rx, ry, rw, rh);
      g.fillStyle = '#0c0d10'; g.fillRect(X(-0.95), Y(2.86), 1.25 * sx, 0.40 * sy); g.fillStyle = 'rgba(255,255,255,0.10)'; for (let y = 2.50; y < 2.85; y += 0.045) g.fillRect(X(-0.93), Y(y), 1.21 * sx, 1.5);     // air grille, top
      g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineWidth = 2; g.strokeRect(X(-0.98), Y(2.30), 1.96 * sx, 1.62 * sy); g.beginPath(); g.moveTo(rx, Y(0.68)); g.lineTo(rx + rw, Y(0.68)); g.stroke();       // engine door
      g.fillStyle = '#12161f'; g.font = `italic 800 ${Math.round(0.085 * sy)}px ${SANS}`; g.fillText('CITY TRANSIT', X(-0.42), Y(2.20)); badge(X(-0.98), Y(2.20), 0.055 * sy, false);
      g.fillStyle = '#f4f2ea'; g.fillRect(X(-0.55), Y(1.72), 1.1 * sx, 0.42 * sy); g.fillStyle = '#a3271c'; g.font = `800 ${Math.round(0.10 * sy)}px ${SANS}`; g.fillText('KOWALSKI’S PICKLES', rx + rw / 2, Y(1.57), 1.0 * sx); g.fillStyle = '#333'; g.font = `500 ${Math.round(0.06 * sy)}px ${SANS}`; g.fillText('Sour since Tuesday.', rx + rw / 2, Y(1.42));
      g.fillStyle = '#e9bd3c'; g.fillRect(X(-0.16), Y(0.98), 0.32 * sx, 0.16 * sy); g.fillStyle = '#1a2a5e'; g.font = `700 ${Math.round(0.075 * sy)}px ${SANS}`; g.fillText('CT·2217', rx + rw / 2, Y(0.90));
      g.fillStyle = '#16181b'; g.fillRect(X(-0.75), Y(0.50), 0.2 * sx, 0.12 * sy); g.fillRect(X(0.55), Y(0.50), 0.2 * sx, 0.12 * sy);
    }
    g.restore();
  };
  face(G.REG.front, false, false); face(G.REG.frontSel, false, true); face(G.REG.rear, true, false);
  // adverts above the windows: eight invented ones
  const ADS = [['#f4e9d2', '#a3271c', 'KOWALSKI’S PICKLES', 'Sour since Tuesday.'], ['#12324e', '#f6f1e4', 'NIGHT COURT COFFEE', 'Open till the 4 a.m. run'], ['#e8f0ea', '#1d5a3c', 'LEARN THE TUBA', 'Riverside Brass School · no neighbours? perfect'], ['#f6c21a', '#1b1b1b', 'IF YOU SEE A SEAT', 'offer it to someone who needs it'],
    ['#f2f2f2', '#0c2f6e', 'CITY TRANSIT', 'Pay at the reader. Keep it moving.'], ['#2a1840', '#f3d9ff', 'MOTH & LANTERN', 'a new musical · Crosby Theatre'], ['#fdf6ec', '#c2410c', 'DR. ABERNATHY, DDS', 'Smiles on 34th since 1988'], ['#0f3d3a', '#eafff8', 'HALCYON BANK', 'Free checking. Actual humans.']];
  { const [rx, ry, rw, rh] = G.REG.ads, w = rw / 8; ADS.forEach((a, i) => { g.fillStyle = a[0]; g.fillRect(rx + i * w, ry, w, rh); g.fillStyle = a[1]; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = `800 24px ${SANS}`; g.fillText(a[2], rx + i * w + 12, ry + 34, w - 24); g.font = `500 13px ${SANS}`; g.fillText(a[3], rx + i * w + 12, ry + 66, w - 24); g.fillRect(rx + i * w + 12, ry + 50, 40, 3); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.strokeRect(rx + i * w + 1, ry + 1, w - 2, rh - 2); }); }
  { const [rx, ry, rw, rh] = G.REG.stop; g.fillStyle = '#0a0a0a'; g.fillRect(rx, ry, rw, rh); g.fillStyle = '#ff3b1f'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 30px ${SANS}`; g.fillText('STOP REQUESTED', rx + rw / 2, ry + rh / 2 + 1, rw - 16); }
  { const [rx, ry, rw, rh] = G.REG.screen; g.fillStyle = '#0c1220'; g.fillRect(rx, ry, rw, rh); g.fillStyle = '#1f6fd0'; g.fillRect(rx + 4, ry + 4, rw - 8, 16); g.fillStyle = '#dfe8f5'; g.font = `600 11px ${SANS}`; g.textAlign = 'left'; g.fillText('ROUTE  ·  NEXT STOP', rx + 8, ry + 13); g.fillStyle = '#7ee08a'; g.fillRect(rx + 8, ry + 30, 50, 22); g.fillStyle = '#f2b21b'; g.fillRect(rx + 66, ry + 30, 50, 22); g.fillStyle = '#394a66'; for (let k = 0; k < 3; k++) g.fillRect(rx + 8, ry + 60 + k * 11, rw - 16, 7); }
  { const [rx, ry, rw, rh] = G.REG.fare; g.fillStyle = '#9da1a5'; g.fillRect(rx, ry, rw, rh); g.fillStyle = '#17191c'; g.fillRect(rx + 8, ry + 8, rw - 16, 34); g.fillStyle = '#6fe07c'; g.font = '700 12px monospace'; g.textAlign = 'center'; g.fillText('FARE', rx + rw / 2, ry + 26); g.fillStyle = '#2b2e33'; g.fillRect(rx + 12, ry + 52, rw - 24, 6); g.fillRect(rx + 20, ry + 70, rw - 40, 22); g.fillStyle = '#c9a227'; g.beginPath(); g.arc(rx + rw / 2, ry + 108, 8, 0, 7); g.fill(); }
  { const [rx, ry, rw, rh] = G.REG.reader; g.fillStyle = '#101216'; g.fillRect(rx, ry, rw, rh); g.fillStyle = '#16a36a'; g.fillRect(rx + 6, ry + 8, rw - 12, 50); g.fillStyle = '#fff'; g.font = `800 15px ${SANS}`; g.textAlign = 'center'; g.fillText('TAP', rx + rw / 2, ry + 28); g.font = `600 10px ${SANS}`; g.fillText('HERE', rx + rw / 2, ry + 44); g.strokeStyle = '#fff'; g.lineWidth = 2; for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(rx + rw / 2 - 8, ry + 78, k * 5, -0.7, 0.7); g.stroke(); } }
  { const [rx, ry, rw, rh] = G.REG.dash; g.fillStyle = '#1b1d20'; g.fillRect(rx, ry, rw, rh); for (let k = 0; k < 14; k++) { g.fillStyle = ['#2f3338', '#b01818', '#2f3338', '#e0a41a', '#2f3338', '#2f8f3f', '#2f3338'][k % 7]; g.fillRect(rx + 10 + k * 17, ry + 12, 11, 11); g.fillStyle = '#2f3338'; g.fillRect(rx + 10 + k * 17, ry + 34, 11, 18); } }
  { const [rx, ry, rw, rh] = G.REG.digits; g.fillStyle = '#000'; g.fillRect(rx, ry, rw, rh); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 88px ${SANS}`; for (let k = 0; k < 10; k++) g.fillText(String(k), rx + k * 64 + 32, ry + 52, 58); }
  { const [rx, ry, rw, rh] = G.REG.plate, gr = g.createLinearGradient(0, ry, 0, ry + rh); gr.addColorStop(0, '#f2c230'); gr.addColorStop(1, '#e8a81c'); g.fillStyle = gr; g.fillRect(rx, ry, rw, rh); g.strokeStyle = '#1a2a5e'; g.lineWidth = 2; g.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4); g.fillStyle = '#1a2a5e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 34px ${SANS}`; g.fillText('CT·2217', rx + rw / 2, ry + 36, rw - 12); g.font = `600 9px ${SANS}`; g.fillText('EMPIRE CITY', rx + rw / 2, ry + 10); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

// ---------------------------------------------------------------- the LED signs: one lamp per texel. Cell n (256 x 24) at column n % 2, row floor(n / 2):
// front and kerb-side sign in texels 0..159 (route number, then destination over "via"), rear route number in 168..215. Cell 0 = NOT IN SERVICE.
function signAtlas(signs) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 1024; const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 1024);
  const F = '"Arial Narrow", "Helvetica Neue", "Liberation Sans Narrow", "Nimbus Sans Narrow", Arial, sans-serif';
  g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  const fit = (t, x, y, maxW, font, align = 'left') => { g.font = font; g.textAlign = align; g.fillText(t, x, y, maxW); };
  const all = [{ nis: true }].concat(signs || []);
  all.slice(0, 84).forEach((s, n) => {
    const x0 = (n % 2) * 256, y0 = Math.floor(n / 2) * 24; g.save(); g.beginPath(); g.rect(x0, y0, 256, 24); g.clip();
    if (s.nis) { fit('NOT IN SERVICE', x0 + 80, y0 + 19, 150, `bold 18px ${F}`, 'center'); }
    else {
      const num = String(s.num || '') + (s.sel && !/\+$/.test(s.num || '') ? '+' : ''); g.font = `bold 23px ${F}`; const nw = Math.min(g.measureText(num).width, 52);
      fit(num, x0 + 1, y0 + 21, 52, `bold 23px ${F}`); const tx = x0 + nw + 7, tw = 160 - nw - 8;
      if (s.via) { fit(String(s.head || '').toUpperCase(), tx, y0 + 11, tw, `bold 12px ${F}`); fit(String(s.via), tx, y0 + 22, tw, `bold 10px ${F}`); } else fit(String(s.head || '').toUpperCase(), tx, y0 + 19, tw, `bold 17px ${F}`);
      fit(num, x0 + 192, y0 + 21, 46, `bold 23px ${F}`, 'center');
    }
    g.restore();
  });
  const im = g.getImageData(0, 0, 512, 1024), d = im.data; for (let i = 0; i < d.length; i += 4) { const v = d[i] > 105 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; return t;
}

function toGeo(S, plain) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(S.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(S.n, 3));
  if (!plain) { g.setAttribute('uv', new THREE.Float32BufferAttribute(S.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(S.c, 3)); g.setAttribute('aFx', new THREE.Float32BufferAttribute(S.fx, 4)); }
  g.setIndex(S.nv > 65535 ? new THREE.Uint32BufferAttribute(S.i, 1) : new THREE.Uint16BufferAttribute(S.i, 1)); return g;
}

export async function makeLook(game, opts = {}) {
  const world = game.world, scene = world.scene, shared = world.shared, cap = opts.cap || 12, signs = opts.signs || [];
  const U = { tBus: { value: paintAtlas() }, tBusSign: { value: signAtlas(signs) }, tBusStreet: { value: new THREE.CubeTexture() }, uBusStreet: { value: 0 } };
  function patch(m, o) {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aVar; ${o.glass ? '' : 'attribute vec4 aFx; varying vec4 vFx; varying vec2 vTuv;'} varying vec4 vVar; varying vec4 vFlag; varying vec2 vBl; varying vec3 vOPos; varying vec3 vWPos; varying vec3 vWNrm;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vVar = aVar; vOPos = position; vFlag = vec4(mod(aVar.z, 2.0), mod(floor(aVar.z / 2.0), 2.0), mod(floor(aVar.z / 4.0), 2.0), mod(floor(aVar.z / 8.0), 2.0)); vBl = vec2(mod(floor(aVar.z / 16.0), 2.0), mod(floor(aVar.z / 32.0), 2.0));     // brake, +SELECT, stop requested, the player's bus; right and left turn lamps lit
          ${o.glass ? '' : 'vFx = aFx; vTuv = uv; if (aFx.w > 7.5 && aFx.w < 8.5) vTuv.x += 0.25 * vFlag.y;'}
          #ifdef USE_INSTANCING
            mat4 busM = modelMatrix * instanceMatrix;
          #else
            mat4 busM = modelMatrix;
          #endif
          vWPos = (busM * vec4(position, 1.0)).xyz; vWNrm = normalize(mat3(busM) * normal);`);
      let f = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          ${o.glass ? '' : 'varying vec4 vFx; varying vec2 vTuv; uniform sampler2D tBus; uniform sampler2D tBusSign;'} varying vec4 vVar; varying vec4 vFlag; varying vec2 vBl; varying vec3 vOPos; varying vec3 vWPos; varying vec3 vWNrm;
          uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter; uniform vec3 uSunDir; uniform samplerCube tBusStreet; uniform float uBusStreet;
          ${NOISE_GLSL}
          // what paint and glass mirror where the game has no picture of the street to give: the streets lane's made-up street (vehicles.js vehEnv)
          vec3 busEnv(vec3 Rw, vec3 skyR, vec3 amb, float skyVis, float sunVis) {
            float az = atan(Rw.z, Rw.x), y = Rw.y / max(length(Rw.xz), 0.05);
            float blk = vnoise(vec2(az * 2.2 + 3.0, 0.5)), roof = mix(0.22, 1.1, 1.0 - skyVis) * (0.55 + 0.9 * blk);
            float wall = smoothstep(roof + 0.02, roof - 0.02, y), lit = smoothstep(-0.2, 0.6, dot(normalize(Rw.xz), -normalize(uSunDir.xz)));
            vec3 tone = mix(vec3(0.30, 0.26, 0.22), vec3(0.55, 0.52, 0.47), vnoise(vec2(az * 2.2 + 3.0, 7.0)));
            vec3 wallC = tone * (amb * 0.9 + uSunColor * 0.9 * lit) * (0.78 + 0.22 * step(0.45, fract(y * 9.0)) * step(0.4, fract(az * 14.0)));
            wallC = mix(wallC, vec3(0.045) * (amb + uSunColor * 0.3), 0.85 * smoothstep(0.17, 0.05, y));
            vec3 ground = mix(vec3(0.11), vec3(0.20), smoothstep(-0.15, -0.7, y)) * (amb * 1.2 + uSunColor * mix(0.9, sunVis, smoothstep(-0.1, -0.6, y)));
            return mix(ground, mix(skyR, wallC, wall), smoothstep(-0.035, 0.01, y));
          }
          vec3 bakeV; vec3 bakeN; float busDirt = 0.0; vec3 busGlow = vec3(0.0);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            bakeN = normalize(vWNrm);
            bakeV = texture2D(tLight, vec2(vWPos.x / (2.0 * uHalf.x) + 0.5, -vWPos.z / (2.0 * uHalf.y) + 0.5)).rgb;
            bakeV.r *= 0.5 + 0.5 * bakeN.y;          // the bake is the ground's: a wall of the bus sees half that sky
            ${o.glass ? `
            float gF = pow(1.0 - abs(dot(bakeN, normalize(cameraPosition - vWPos))), 4.0);
            diffuseColor.a = mix(mix(0.58, 0.96, gF), 0.04 + 0.3 * gF, vFlag.w);      // dark from the street, clear for the rider` : `
            float kind = vFx.w, night = fract(vVar.w) / 0.99, bDirt = fract(vVar.x) / 0.99;
            if (kind > 4.5 && kind < 6.5) {         // LED sign: one amber lamp per texel of the sign picture
              vec2 dots = kind < 5.5 ? vec2(160.0, 24.0) : vec2(48.0, 24.0), p = vec2(vTuv.x, 1.0 - vTuv.y) * dots, cc = floor(p), ff = fract(p) - 0.5;
              vec2 org = vec2(mod(vVar.y, 2.0) * 256.0 + (kind < 5.5 ? 0.0 : 168.0), floor(vVar.y / 2.0) * 24.0);
              float on = texture2D(tBusSign, (org + cc + 0.5) / vec2(512.0, 1024.0)).r, fw = max(fwidth(p.x), fwidth(p.y));
              float lamp = mix(smoothstep(0.5, 0.26, length(ff)), 0.45, clamp(fw * 1.5 - 0.4, 0.0, 1.0));
              busGlow = vec3(1.0, 0.50, 0.05) * on * lamp * 3.4; diffuseColor.rgb = vec3(0.012) + vec3(0.02, 0.012, 0.004) * lamp;
            } else if (kind > 6.5 && kind < 7.5) {      // one place of the fleet number: the digit comes from the bus's own number
              float pl = floor(vTuv.x), dg = mod(floor(floor(vVar.x) / pow(10.0, 3.0 - pl) + 0.001), 10.0);
              float cov = texture2D(tBus, vec2((832.0 + (dg + fract(vTuv.x)) * 64.0) / 2048.0, 1.0 - (1664.0 + (1.0 - vTuv.y) * 96.0) / 2048.0)).r;
              diffuseColor.rgb = mix(diffuseColor.rgb, dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1)) > 0.25 ? vec3(0.015) : vec3(0.9), cov);
            } else if (vTuv.x > -0.5) diffuseColor.rgb *= texture2D(tBus, vTuv).rgb;
            if (kind > 9.5) {      // riders: dark November coats, trousers, skin, each from the rider's own number (below 1: the driver's uniform)
              float h1 = hash11(vVar.x * 1.37), h2 = hash11(vVar.x * 2.91 + 5.0);
              vec3 cc = h1 < 0.38 ? vec3(0.012, 0.012, 0.014) : h1 < 0.55 ? vec3(0.015, 0.022, 0.05) : h1 < 0.68 ? vec3(0.045, 0.05, 0.03) : h1 < 0.78 ? vec3(0.09, 0.02, 0.025) : h1 < 0.9 ? vec3(0.07, 0.07, 0.075) : vec3(0.22, 0.15, 0.08);
              if (kind > 10.5) cc = h2 < 0.5 ? vec3(0.014, 0.016, 0.022) : h2 < 0.8 ? vec3(0.03, 0.05, 0.10) : vec3(0.06, 0.055, 0.05);
              if (vVar.x < 1.0) cc = kind > 10.5 ? vec3(0.012, 0.014, 0.025) : vec3(0.02, 0.03, 0.07);
              if (kind > 11.5) { float sk = hash11(vVar.x * 4.7 + 1.0); cc = mix(vec3(0.22, 0.16, 0.13), vec3(1.0, 0.92, 0.88), sk * sk) * (0.72 + 0.28 * smoothstep(-0.3, 0.5, bakeN.y)); }      // skin from deep brown to pale, a little darker under the chin
              diffuseColor.rgb *= cc;
            }
            if (kind > 3.5 && kind < 4.5 && abs(vOPos.z) > 1.2 && vOPos.x < 4.4) {      // from further off at night: the lit cabin behind the glass and a row of heads against it
              float hx = vOPos.x / 0.47, hc = floor(hx), there = step(hash11(hc * 3.1 + vVar.y * 7.0 + sign(vOPos.z)), floor(vVar.w) / 15.0);
              vec2 hp = vec2((fract(hx) - 0.5) * 0.47, vOPos.y - 1.56); float sil = there * max(smoothstep(0.13, 0.10, length(hp)), smoothstep(0.21, 0.17, abs(hp.x)) * smoothstep(-0.10, -0.14, hp.y));
              busGlow = vec3(1.0, 0.95, 0.86) * night * mix(0.16, 0.5, smoothstep(2.0, 2.45, vOPos.y)) * (1.0 - 0.85 * sil);
            }
            if (kind > 8.5 && kind < 9.5) { float sp = hash21(floor(vOPos.xz * 240.0)); diffuseColor.rgb *= 0.80 + 0.55 * step(0.78, sp) - 0.32 * step(sp, 0.14); }
            if (kind < 1.5 || (kind > 7.5 && kind < 8.5)) {      // road dirt, low on the body
              float n1 = fbm(vec2(vOPos.x * 1.3 + vVar.y * 37.0, vOPos.z * 1.3 + vOPos.y * 0.8));
              busDirt = clamp(bDirt * smoothstep(1.15, 0.25, vOPos.y) * (0.3 + 1.0 * n1), 0.0, 0.8);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.10, 0.085), busDirt);
            }
            float g = vFx.z;
            if (g > 0.5) {
              if (g < 1.5) busGlow = vec3(1.0, 0.97, 0.9) * mix(0.35, 6.0, night);
              else if (g < 2.5) busGlow = vec3(1.0, 0.03, 0.01) * mix(0.06 + 0.5 * night, 5.5, vFlag.x);
              else if (g < 3.5) busGlow = vec3(1.0, 0.97, 0.92) * mix(1.3, 0.55, night);      // (the game opens its exposure at night: the strips must not burn out)
              else if (g < 4.5) busGlow = vec3(1.0, 0.42, 0.04) * mix(0.10, 1.5, night);
              else if (g < 5.5) busGlow = vec3(1.0, 0.03, 0.01) * mix(0.06, 1.2, night);
              else if (g < 6.5) { busGlow = diffuseColor.rgb * vFlag.z * 3.0; diffuseColor.rgb *= 0.12; }
              else if (g < 7.5) busGlow = diffuseColor.rgb * 0.8;
              else busGlow = vec3(1.0, 0.42, 0.04) * (mix(0.10, 0.9, night) + 7.0 * (g < 8.5 ? vBl.x : vBl.y));      // turn lamps
            }`}
          }`)
        .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + (o.glass ? '' : `
          if ((vFx.w > 1.5 && vFx.w < 2.5) || vFx.w > 8.5) {      // the cabin: shaded by the roof, lit by its own strip lights
            reflectedLight.directDiffuse *= 0.6; reflectedLight.directSpecular *= 0.3;
            reflectedLight.indirectDiffuse = reflectedLight.indirectDiffuse * 0.75 + material.diffuseColor * vec3(1.0, 0.97, 0.92) * mix(0.30 + 0.30 * max(-bakeN.y, 0.0), 0.16 + 0.10 * max(-bakeN.y, 0.0), fract(vVar.w) / 0.99);
          }`));
      if (!o.glass) f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(vFx.x, 0.93, busDirt);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = vFx.y * (1.0 - busDirt);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += busGlow;');
      // lacquer and glass mirror the street (the streets lane's way: Fresnel over the lit surface); body panels are never quite flat
      f = f.replace('#include <opaque_fragment>', `{
          ${o.glass ? 'float rk = 1.0 - vFlag.w;' : 'float rk = (vFx.w < 1.5 || (vFx.w > 3.5 && vFx.w < 4.5) || (vFx.w > 7.5 && vFx.w < 8.5)) ? smoothstep(0.5, 0.2, vFx.x) * (1.0 - busDirt) : 0.0;'}
          if (rk > 0.0) {
            vec3 Nw = normalize(vWNrm);
            ${o.glass ? '' : 'if (vFx.w > 0.5 && vFx.w < 1.5 && abs(Nw.y) < 0.6) { float rp = vnoise(vOPos.xy * vec2(1.3, 2.1) + vOPos.z) - 0.5, rq = vnoise(vOPos.xy * vec2(2.3, 1.1) + 9.0) - 0.5; Nw = normalize(Nw + vec3(0.0, rp * 0.07, 0.0) + cross(Nw, vec3(0.0, 1.0, 0.0)) * rq * 0.05); }'}
            vec3 Vw = normalize(cameraPosition - vWPos), Rw = reflect(-Vw, Nw);
            float Fc = min(0.05 + 0.95 * pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 5.0), 0.6);
            #ifdef USE_ENVMAP
              vec3 skyR = getIBLRadiance(geometryViewDir, geometryNormal, 0.15), amb = getIBLRadiance(geometryViewDir, geometryNormal, 1.0);
            #else
              vec3 skyR = vec3(1.0), amb = vec3(0.5);
            #endif
            vec3 env = busEnv(Rw, skyR, amb, clamp(bakeV.r, 0.0, 1.0), bakeV.g);
            if (uBusStreet > 0.5) env = mix(env, min(texture(tBusStreet, Rw).rgb, vec3(3.0)), 0.9);
            env += uSunColor * 7.0 * pow(max(dot(Rw, normalize(uSunDir)), 0.0), 500.0) * clamp(reflectedLight.directDiffuse.g * 6.0, 0.0, 1.0);
            ${o.glass ? 'float ga = clamp(diffuseColor.a + Fc * 1.4, 0.0, 1.0); outgoingLight = mix(outgoingLight, (outgoingLight * 0.6 + env * Fc * 1.7) / ga, rk); diffuseColor.a = mix(diffuseColor.a, ga, rk);'
              : 'float gl = vFx.w > 3.5 && vFx.w < 4.5 ? 1.35 : 0.8; outgoingLight = outgoingLight * (1.0 - Fc * rk) + env * min(Fc * gl, 1.0) * rk;'}
          }
        }
        #include <opaque_fragment>`);
      sh.fragmentShader = f;
    };
    m.customProgramCacheKey = () => 'bus2' + JSON.stringify(o);
    return m;
  }
  const MAT = {
    body: patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true, envMapIntensity: 1.0 }), {}),
    glass: patch(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.014, 0.02, 0.022), roughness: 0.04, metalness: 0, envMapIntensity: 1.3, transparent: true, depthWrite: false }), { glass: 1 }),
  };
  const group = new THREE.Group(); group.name = 'bus_look'; scene.add(group);
  const attr = (n, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); return a; };
  class Set_ {                                    // instances that share matrices and per-bus values
    constructor(n) { this.cap = n; this.n = 0; this.mat = attr(n, 16); this.va = attr(n, 4); this.meshes = []; this.tris = 0; }
    addMesh(soup, mat, glass, noShadow) {
      const geo = toGeo(soup, glass); geo.setAttribute('aVar', this.va); const im = new THREE.InstancedMesh(geo, mat, this.cap); im.instanceMatrix = this.mat;
      im.frustumCulled = false; im.castShadow = !glass && !noShadow; im.receiveShadow = true; im.count = 0; im.visible = false; im.matrixAutoUpdate = false; if (glass) im.renderOrder = 2; group.add(im); this.meshes.push(im); this.tris += soup.nt; return im;
    }
    put(m, a, b, c, d) { const i = this.n; if (i >= this.cap) return -1; m.toArray(this.mat.array, i * 16); const v = this.va.array; v[i * 4] = a; v[i * 4 + 1] = b; v[i * 4 + 2] = c; v[i * 4 + 3] = d; this.n = i + 1; return i; }
    end() { for (const im of this.meshes) { im.count = this.n; im.visible = this.n > 0; } if (this.n) { this.mat.clearUpdateRanges(); this.mat.addUpdateRange(0, this.n * 16); this.mat.needsUpdate = true; this.va.clearUpdateRanges(); this.va.addUpdateRange(0, this.n * 4); this.va.needsUpdate = true; } }
  }
  const nearCap = Math.min(cap, NEAR_CAP + 1), B0 = G.build(0, opts), B1 = G.build(1, opts), B2 = G.build(2, opts);      // opts.rack = true: a bike rack on the nose (the Manhattan buses in the reference photos carry none)
  const L0 = { body: new Set_(nearCap), leaf: new Set_(nearCap * 4), wheel: new Set_(nearCap * 6) }, L1 = new Set_(cap), L2 = new Set_(cap);
  L0.body.addMesh(B0.body, MAT.body); L0.body.addMesh(B0.glass, MAT.glass, true); L0.leaf.addMesh(B0.leaf, MAT.body); L0.leaf.addMesh(B0.leafGlass, MAT.glass, true); L0.wheel.addMesh(B0.wheel, MAT.body);
  L1.addMesh(B1.body, MAT.body); L2.addMesh(B2.body, MAT.body);
  const RID = B0.riders.map((R) => { const s = new Set_(nearCap * (G.SEATS.length + 1)); s.addMesh(R, MAT.body, false, true); return s; }), figs = opts.riders !== false;      // the seated riders and the driver: two builds, each rider its own size and colours
  const sets = [L0.body, L0.leaf, L0.wheel, L1, L2, RID[0], RID[1]], hsh = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }, _s = new THREE.Vector3();
  let srcSt = null, tries = 0;                      // the streets lane's live picture of the street (the cube its cars mirror), found on one of its compiled materials
  const linkStreet = () => { for (const top of scene.children) if (/^streets_vehicles/.test(top.name || '')) top.traverse((o) => { if (srcSt || !o.material) return; const pr = world.renderer.properties.get(o.material), u = pr && pr.uniforms; if (u && u.tVehStreet && u.uVehStreet) srcSt = u; }); };
  const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _k = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _r2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  let nNear = 0, last = { tris: 0, draws: 0 }, blinkOn = false;
  const look = {
    DIMS, group, tris: [B0.body.nt + B0.glass.nt + 4 * (B0.leaf.nt + B0.leafGlass.nt) + 6 * B0.wheel.nt, B1.body.nt, B2.body.nt],
    begin() { for (const s of sets) s.n = 0; nNear = 0; if (!srcSt && tries < 3000 && tries++ % 150 === 0 && opts.street !== false) try { linkStreet(); } catch (e) { tries = 1e9; } if (srcSt) { U.uBusStreet.value = srcSt.uVehStreet.value; if (srcSt.tVehStreet.value) U.tBusStreet.value = srcSt.tVehStreet.value; } blinkOn = (performance.now() % 760) < 400; },
    add(b) {
      const lod = b.lod !== undefined ? b.lod : b.inside ? 0 : b.d < NEAR && nNear < NEAR_CAP ? 0 : b.d < MID ? 1 : 2;
      _e.set(b.roll || 0, b.h || 0, b.pitch || 0, 'YZX'); _q.setFromEuler(_e); _m.compose(_v.set(b.x, b.z || 0, -b.y), _q, _one);
      const k = b.kneel || 0, sg = b.sign === undefined ? -1 : b.sign, sel = sg >= 0 && signs[sg] && signs[sg].sel ? 1 : 0;
      const flags = (b.brake ? 1 : 0) + 2 * sel + (b.stopReq ? 4 : 0) + (b.inside ? 8 : 0) + (blinkOn && b.blink > 0 ? 16 : 0) + (blinkOn && b.blink < 0 ? 32 : 0), rid = Math.max(0, Math.min(1, b.riders === undefined ? 0.4 : b.riders)), cell = sg + 1;
      const no = Math.floor(b.no > 0 ? b.no % 10000 : 4827), dirt = no + 0.99 * Math.max(0, Math.min(1, b.dirt === undefined ? 0.4 : b.dirt)), night = Math.round(rid * 15) + 0.99 * Math.max(0, Math.min(1, b.night || 0));      // packed: the fleet number with the dirt, the load with the night
      _b.copy(_m); if (k > 0) { _k.makeRotationX(0.027 * k); _t.makeRotationZ(-0.0035 * k); _k.multiply(_t); _k.elements[13] = -0.012 * k; _b.multiply(_k); }       // kneeling: the front kerb corner comes down about 7 cm
      if (lod === 2) { L2.put(_b, dirt, cell, flags, night); return; }
      if (lod === 1) { L1.put(_b, dirt, cell, flags, night); return; }
      if (L0.body.put(_b, dirt, cell, flags, night) < 0) { L1.put(_b, dirt, cell, flags, night); return; }
      nNear++;
      if (figs) { const cam = world.camera.position, id = b.id || 1, nt = 0.99 * Math.max(0, Math.min(1, b.night || 0));
        const sit = (p, yaw, seed) => { _t.makeTranslation(p[0], p[1], p[2]); _r.makeRotationY(yaw); _k.multiplyMatrices(_b, _t).multiply(_r); const e = _k.elements, dx = e[12] - cam.x, dy = e[13] + 0.6 - cam.y, dz = e[14] - cam.z; if (dx * dx + dy * dy + dz * dz < 0.5) return;      // never one where the eye is (the player's seat, the wheel)
          const h = hsh(seed * 1.31); _k.scale(_s.set(0.93 + 0.12 * hsh(seed * 2.7), 0.90 + 0.14 * h, 0.90 + 0.2 * hsh(seed * 5.1))); RID[hsh(seed * 9.7) < 0.55 ? 0 : 1].put(_k, seed, cell, flags, nt); };
        sit(G.DRIVER, 0, 0.5);
        for (let i = 0; i < G.SEATS.length; i++) if (i !== b.seat && hsh(id * 13.7 + i * 7.31) < rid) { const s = G.SEATS[i]; sit(s, s[3], 2 + ((id * 41 + i) % 9000)); } }
      for (const [hx, hz, dir, swing, which] of G.LEAVES) {
        const open = which === 'F' ? b.doorF || 0 : b.doorR || 0, th = (dir > 0 ? 0 : Math.PI) + (dir > 0 ? -1 : 1) * swing * open * 1.48;
        _t.makeTranslation(hx, G.YFL + 0.015, hz + (swing < 0 ? -0.03 * open : 0.02 * open)); _r.makeRotationY(th); _k.multiplyMatrices(_b, _t).multiply(_r); L0.leaf.put(_k, dirt, cell, flags, night);
      }
      for (const [wx, wz, flip, steers] of G.WHEELS) {
        _t.makeTranslation(wx, G.RADIUS, wz); _r.makeRotationY((steers ? b.steer || 0 : 0) + (flip ? Math.PI : 0)); _r2.makeRotationZ((flip ? 1 : -1) * (b.spin || 0));
        _k.multiplyMatrices(_m, _t).multiply(_r).multiply(_r2); L0.wheel.put(_k, dirt, cell, flags, night);
      }
    },
    end() { let tris = 0, draws = 0; for (const s of sets) { s.end(); if (s.n) { tris += s.n * s.tris; draws += s.meshes.length; } } last = { tris, draws }; },
    stats() { return last; },
    dispose() { scene.remove(group); for (const s of sets) for (const im of s.meshes) { im.geometry.dispose(); } U.tBus.value.dispose(); U.tBusSign.value.dispose(); MAT.body.dispose(); MAT.glass.dispose(); },
  };
  return look;
}
