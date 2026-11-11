// furniture.js (streets lane, part: furniture): what stands on the street. Signals, street lights, signs, hydrants, litter baskets,
// trash, bus stops, bikes, plaza furniture, park fences, work sites and scaffolding, all placed by rule over game.city.
// It replaces the lead's prop kinds signal / light / hydrant / bin / meter / newsbox (hidden) and the dressing layer's
// blade / oneway / psign (+ their posts) / bags (hidden); everything else of the dressing layer is kept and built around.
//   frame     a prototype is modelled y up, +X = its heading (a map angle, counter-clockwise from east), +Z = to the right of the heading.
//             Kerb things take the kerb tangent (block ring walked counter-clockwise) as heading, so +Z is the roadway side.
//   material  one MeshStandardMaterial for all modelled pieces: vertex colour x a canvas atlas (signs, stickers, flyers, posters),
//             plus world-space weather in the shader (rain streaks, dirt climbing from the base, rust keyed to a per-vertex
//             "rust-prone" value, paint chips) and the ground light bake beyond the shadow map. Scanned props (Poly Haven, CC0) keep
//             their own textures and get the same base dirt and bake.
//   bands     every kind is instanced per 190 m map tile with a far limit; signals, lights, bags and hydrants have cheap stand-ins.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BAKE_LIGHT_GLSL } from '../facade.js';

const TAU = Math.PI * 2, PI = Math.PI;
const hsh = (a, b = 0, c = 0) => { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719 + 0.5) * 43758.5453; return s - Math.floor(s); };
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const WHITE = [1, 1, 1];
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

// ------------------------------------------------------------------------------------------------ the atlas (one canvas)
const AW = 2048, AH = 2048;
const PARK_SIGNS = [
  ['r', 'NO', 'STANDING', 'ANYTIME'], ['r', 'NO PARKING', '8AM-6PM', 'MON THRU FRI'], ['g', '2 HOUR', 'PARKING', '9AM-7PM', 'EXCEPT SUN'], ['r', 'NO PARKING', 'TUES & FRI', '9-10:30AM'],
  ['r', 'TRUCK', 'LOADING', 'ONLY', '7AM-7PM'], ['r', 'NO', 'STOPPING', 'ANYTIME'], ['g', '1 HOUR', 'METERED', 'PARKING', '8AM-10PM'], ['r', 'NO STANDING', 'EXCEPT', 'TRUCKS', 'LOADING']];
function shortName(n) {
  return n.replace(/^West /, 'W ').replace(/^East /, 'E ').replace(/(\d+)(st|nd|rd|th)\b/, '$1').replace(/ Street$/, ' St').replace(/ Avenue$/, ' Av').replace(/^Avenue of the Americas$/, '6 Av').replace(/ Place$/, ' Pl').replace(/ Square$/, ' Sq');
}
function makeAtlas(names) {
  const c = document.createElement('canvas'); c.width = AW; c.height = AH; const g = c.getContext('2d');
  const cells = {}; let sx = 0, sy = 0, sh = 0; const PAD = 4;
  // a family of n equal cells, `cols` to a row; draw(g, i, w, h) paints one with the origin at its corner
  const fam = (name, w, h, n, cols, draw) => {
    const rows = Math.ceil(n / cols), bw = (w + PAD) * cols, bh = (h + PAD) * rows;
    if (sx + bw > AW) { sx = 0; sy += sh; sh = 0; }
    const x0 = sx, y0 = sy; sx += bw; sh = Math.max(sh, bh);
    for (let i = 0; i < n; i++) { const x = x0 + (i % cols) * (w + PAD) + PAD / 2, y = y0 + Math.floor(i / cols) * (h + PAD) + PAD / 2; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, i, w, h); g.restore(); }
    const e = 1.2; cells[name] = { u0: (x0 + PAD / 2 + e) / AW, u1: (x0 + PAD / 2 + w - e) / AW, v0: 1 - (y0 + PAD / 2 + h - e) / AH, v1: 1 - (y0 + PAD / 2 + e) / AH, du: (w + PAD) / AW, dv: -(h + PAD) / AH, cols, n };
  };
  const F = (px, wgt = 'bold') => `${wgt} ${px}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const txt = (s, x, y, px, col, maxW, wgt) => { g.font = F(px, wgt); g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; const w = g.measureText(s).width; g.save(); g.translate(x, y); if (maxW && w > maxW) g.scale(maxW / w, 1); g.fillText(s, 0, 0); g.restore(); };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath(); };
  const grime = (w, h, k, seed = 1) => { for (let i = 0; i < k; i++) { const a = hsh(i, seed), b = hsh(i, seed, 2), d = hsh(i, seed, 3); g.fillStyle = `rgba(${30 + d * 50 | 0},${26 + d * 40 | 0},${20 + d * 30 | 0},${0.04 + 0.1 * hsh(i, seed, 4)})`; g.fillRect(a * w, b * h, 1 + d * 2.5, 4 + hsh(i, seed, 5) * h * 0.3); } };
  const fade = (w, h, a) => { g.fillStyle = `rgba(215,212,200,${a})`; g.fillRect(0, 0, w, h); };

  // tall things first (shelf packing)
  fam('banner', 128, 320, 4, 4, (g, i, w, h) => {
    const bg = ['#e3e0d5', '#e6e1d3', '#dde1e0', '#e5dfcc'][i], fg = ['#2c6b58', '#a55030', '#3a5684', '#7d6420'][i];
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, 118); g.fillStyle = fg; g.globalAlpha = 0.92;
    if (i === 0) { for (let k = 0; k < 7; k++) { g.save(); g.rotate((k - 3) * 0.42); g.beginPath(); g.moveTo(0, 18); g.quadraticCurveTo(15, -22, 0, -62); g.quadraticCurveTo(-15, -22, 0, 18); g.fill(); g.restore(); } g.fillRect(-2.5, 10, 5, 58); }
    else if (i === 1) { g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.fill(); g.fillStyle = bg; for (let k = 0; k < 12; k++) { g.save(); g.rotate(k * TAU / 12); g.fillRect(-2, -44, 4, 22); g.restore(); } }
    else if (i === 2) { for (let k = 0; k < 4; k++) g.fillRect(-40 + k * 22, -50 + (k % 2) * 16, 14, 100 - (k % 2) * 32); }
    else { g.beginPath(); g.moveTo(-42, 36); g.lineTo(0, -52); g.lineTo(42, 36); g.closePath(); g.fill(); g.fillStyle = bg; g.fillRect(-9, 4, 18, 32); }
    g.restore();
    const t = [['ART IN', 'THE PARK'], ['OPEN', 'STREETS'], ['23RD ST', 'DISTRICT'], ['FARMERS', 'MARKET']][i];
    txt(t[0], w / 2, 224, 25, fg, w - 14); txt(t[1], w / 2, 254, 25, fg, w - 14); txt(['MAY - OCTOBER', 'SATURDAYS', 'SHOP · DINE · STROLL', 'WED & SAT 8-4'][i], w / 2, 292, 11, fg, w - 14, '600');
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7); fade(w, h, 0.1); grime(w, h, 26, i + 3);
  });
  fam('kiosk', 128, 320, 2, 2, (g, i, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, i ? '#f0b441' : '#2a7fb8'); gr.addColorStop(1, i ? '#d2562a' : '#123c63'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    txt(i ? 'CITY INFO' : 'FREE WI-FI', w / 2, 70, 21, '#ffffff', w - 14); txt(i ? 'Maps · Transit · Events' : 'Charge here', w / 2, 100, 10, '#ffffff', w - 14, '500');
    g.fillStyle = 'rgba(255,255,255,0.9)'; if (i) { g.beginPath(); g.arc(w / 2, 180, 34, 0, TAU); g.fill(); g.fillStyle = '#d2562a'; g.beginPath(); g.moveTo(w / 2, 214); g.lineTo(w / 2 - 18, 180); g.lineTo(w / 2 + 18, 180); g.fill(); } else for (let k = 0; k < 3; k++) { g.beginPath(); g.lineWidth = 7; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.arc(w / 2, 210, 18 + k * 17, -PI * 0.78, -PI * 0.22); g.stroke(); }
    txt('12:48', w / 2, 262, 26, '#ffffff', w - 20, '300'); txt('Partly cloudy 74°', w / 2, 288, 10, '#ffffff', w - 14, '500'); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, w * 0.45, h);
  });
  fam('ad', 192, 288, 2, 2, (g, i, w, h) => {
    g.fillStyle = i ? '#e9e2d0' : '#191c22'; g.fillRect(0, 0, w, h);
    if (i) { g.fillStyle = '#c0392b'; g.beginPath(); g.arc(w / 2, 108, 62, 0, TAU); g.fill(); g.fillStyle = '#e9e2d0'; g.beginPath(); g.arc(w / 2 + 20, 92, 50, 0, TAU); g.fill(); txt('SPRING', w / 2, 204, 34, '#1c1c1c', w - 24); txt('CONCERT SERIES', w / 2, 236, 15, '#1c1c1c', w - 24); txt('FREE · EVERY THURSDAY · 7PM', w / 2, 262, 9, '#555', w - 20, '600'); }
    else { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#31406b'); gr.addColorStop(1, '#0d1018'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#e8c15a'; for (let k = 0; k < 5; k++) g.fillRect(30 + k * 28, 150 - k * 22, 18, 60 + k * 22); txt('RIDE THE', w / 2, 46, 18, '#ffffff', w - 24, '500'); txt('CROSSTOWN', w / 2, 78, 28, '#ffffff', w - 20); txt('every 6 minutes', w / 2, 250, 13, '#e8c15a', w - 24, '600'); }
    fade(w, h, 0.07); grime(w, h, 18, i + 11);
  });
  fam('bus', 128, 256, 1, 1, (g, i, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#1c4f9c'; g.beginPath(); g.arc(w / 2, 62, 60, 0, TAU); g.fill(); g.strokeStyle = '#f2f2ee'; g.lineWidth = 4; g.beginPath(); g.arc(w / 2, 62, 53, 0, TAU); g.stroke();
    g.fillStyle = '#f2f2ee'; rr(w / 2 - 30, 30, 60, 50, 8); g.fill(); g.fillStyle = '#1c4f9c'; g.fillRect(w / 2 - 24, 38, 48, 18); g.fillRect(w / 2 - 22, 68, 9, 6); g.fillRect(w / 2 + 13, 68, 9, 6); g.fillStyle = '#f2f2ee'; g.fillRect(w / 2 - 22, 80, 10, 8); g.fillRect(w / 2 + 12, 80, 10, 8);
    txt('BUS', w / 2, 102, 13, '#f2f2ee');
    const rts = [['X23', '#1c4f9c'], ['X5', '#1c4f9c'], ['LTD', '#7a2a8c']];
    rts.forEach((r, k) => { g.fillStyle = r[1]; g.fillRect(8, 128 + k * 42, w - 16, 38); txt(r[0], 36, 148 + k * 42, 20, '#fff', 44); txt(['Crosstown', 'Downtown', 'Limited'][k], 88, 148 + k * 42, 10, '#fff', 62, '500'); });
    grime(w, h, 14, 5);
  });
  fam('dock', 128, 256, 1, 1, (g, i, w, h) => {
    g.fillStyle = '#16806e'; g.fillRect(0, 0, w, h); txt('BIKE HUB', w / 2, 28, 20, '#fff', w - 12); g.fillStyle = '#e6e9e4'; g.fillRect(10, 50, w - 20, 120); g.strokeStyle = '#9aa6a0'; g.lineWidth = 1;
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(10, 50 + k * 15); g.lineTo(w - 10, 50 + k * 15 + (k % 3) * 4); g.stroke(); g.beginPath(); g.moveTo(10 + k * 13, 50); g.lineTo(10 + k * 13 + (k % 2) * 6, 170); g.stroke(); }
    g.fillStyle = '#d2562a'; g.beginPath(); g.arc(70, 104, 5, 0, TAU); g.fill(); g.fillStyle = '#0c1512'; g.fillRect(24, 182, w - 48, 44); txt('TAP TO RIDE', w / 2, 204, 10, '#7fe0c5', w - 56); txt('$ per ride · day pass', w / 2, 240, 8, '#fff', w - 12, '500'); fade(w, h, 0.1); grime(w, h, 16, 8);
  });
  fam('park', 192, 288, 8, 8, (g, i, w, h) => {
    g.scale(1.5, 1.5); w = 128; h = 192;
    const P = PARK_SIGNS[i], col = P[0] === 'r' ? '#b3261e' : '#1c6b3a';
    g.fillStyle = '#e9e8e1'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 5; rr(6, 6, w - 12, h - 12, 9); g.stroke();
    const lines = P.slice(1), lh = 118 / lines.length; lines.forEach((t, k) => txt(t, w / 2, 26 + lh * (k + 0.5), Math.min(27, lh * 0.76), col, w - 36));
    g.fillStyle = col; g.fillRect(34, 164, 60, 5); g.beginPath(); g.moveTo(20, 166.5); g.lineTo(38, 156); g.lineTo(38, 177); g.fill(); if (i % 3) { g.beginPath(); g.moveTo(108, 166.5); g.lineTo(90, 156); g.lineTo(90, 177); g.fill(); }
    g.fillStyle = '#8d8f8c'; g.beginPath(); g.arc(w / 2, 14, 3, 0, TAU); g.arc(w / 2, h - 14, 3, 0, TAU); g.fill(); fade(w, h, 0.12 + 0.08 * (i % 3)); grime(w, h, 22, i + 20);
  });
  fam('news', 96, 160, 6, 6, (g, i, w, h) => {
    const nm = ['THE BLOCK', 'UPTOWN WEEKLY', 'FREE TIMES', 'APARTMENTS', 'DAILY LEDGER', 'NIGHT GUIDE'][i];
    g.fillStyle = '#d8d8d2'; g.fillRect(0, 0, w, h); g.fillStyle = '#14161a'; g.fillRect(6, 34, w - 12, 100); g.fillStyle = '#e8e4d6'; g.fillRect(12, 40, w - 24, 88);
    txt(nm, w / 2, 52, 11, '#111', w - 30); g.fillStyle = '#777'; g.fillRect(16, 62, w - 32, 26); g.fillStyle = '#333'; for (let k = 0; k < 6; k++) g.fillRect(16, 94 + k * 5, (w - 32) * (0.6 + 0.4 * hsh(i, k)), 2);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.moveTo(6, 34); g.lineTo(50, 34); g.lineTo(20, 134); g.lineTo(6, 134); g.fill();
    txt(i % 2 ? 'FREE' : 'TAKE ONE', w / 2, 18, 14, '#111', w - 12); g.fillStyle = '#222'; g.fillRect(w / 2 - 14, 142, 28, 8); grime(w, h, 24, i + 40);
  });
  fam('meter', 96, 160, 1, 1, (g, i, w, h) => {
    g.fillStyle = '#2d3238'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c5aa6'; g.fillRect(0, 0, w, 30); txt('PAY HERE', w / 2, 16, 14, '#fff', w - 10); g.fillStyle = '#9fb4a4'; g.fillRect(14, 40, w - 28, 34); txt('2 HR MAX', w / 2, 57, 10, '#1b2a20', w - 34);
    g.fillStyle = '#111'; g.fillRect(16, 86, 30, 6); g.fillRect(56, 84, 24, 16); g.fillStyle = '#c7b24a'; g.beginPath(); g.arc(26, 114, 7, 0, TAU); g.fill(); g.fillStyle = '#3d8f4e'; g.beginPath(); g.arc(48, 114, 7, 0, TAU); g.fill(); g.fillStyle = '#a33'; g.beginPath(); g.arc(70, 114, 7, 0, TAU); g.fill();
    g.fillStyle = '#0c0c0c'; g.fillRect(20, 134, w - 40, 14); grime(w, h, 26, 61);
  });
  fam('closed', 160, 160, 2, 2, (g, i, w, h) => {
    if (i === 0) { g.fillStyle = '#e8762a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#141414'; g.lineWidth = 4; g.strokeRect(7, 7, w - 14, h - 14); txt('SIDEWALK', w / 2, 44, 26, '#141414', w - 26); txt('CLOSED', w / 2, 76, 30, '#141414', w - 26); txt('USE OTHER SIDE', w / 2, 112, 15, '#141414', w - 26); g.fillStyle = '#141414'; g.fillRect(40, 132, 70, 7); g.beginPath(); g.moveTo(124, 135.5); g.lineTo(106, 124); g.lineTo(106, 147); g.fill(); }
    else { g.fillStyle = '#ecebe4'; g.fillRect(0, 0, w, h); g.fillStyle = '#1c4f9c'; g.fillRect(0, 0, w, 30); txt('WORK PERMIT', w / 2, 16, 15, '#fff', w - 14); g.fillStyle = '#333'; for (let k = 0; k < 11; k++) g.fillRect(12, 42 + k * 10, (w - 24) * (0.45 + 0.55 * hsh(k, 7)), 3); g.strokeStyle = '#b3261e'; g.lineWidth = 2; g.strokeRect(96, 112, 50, 34); txt('DOB', 121, 129, 13, '#b3261e', 44); }
    fade(w, h, 0.1); grime(w, h, 26, 70 + i);
  });
  fam('cab', 96, 128, 1, 1, (g, i, w, h) => {
    g.fillStyle = '#7d8284'; g.fillRect(0, 0, w, h); g.strokeStyle = '#4b4f50'; g.lineWidth = 2; g.strokeRect(4, 4, w - 8, h - 8); g.fillStyle = '#4b4f50'; for (let k = 0; k < 6; k++) g.fillRect(16, 14 + k * 5, w - 32, 2);
    g.fillStyle = '#2a2c2d'; g.fillRect(w - 20, 62, 8, 16); g.fillStyle = '#e3c23a'; g.fillRect(14, 92, 30, 22); g.fillStyle = '#111'; g.beginPath(); g.moveTo(29, 96); g.lineTo(38, 110); g.lineTo(20, 110); g.fill();
    g.strokeStyle = 'rgba(20,20,22,0.75)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(40, 58); g.bezierCurveTo(54, 30, 62, 84, 74, 50); g.bezierCurveTo(80, 40, 60, 46, 84, 74); g.stroke(); grime(w, h, 40, 81);
  });
  fam('cart', 256, 128, 3, 3, (g, i, w, h) => {
    const bg = ['#c9302a', '#1f4f8f', '#e0b43a'][i], fg = ['#fff6d8', '#ffffff', '#1c1c1c'][i];
    g.fillStyle = '#b9bcbc'; g.fillRect(0, 0, w, h); g.fillStyle = bg; g.fillRect(8, 8, w - 16, 74);
    const t = [['HOT DOGS', 'PRETZELS · SODA · WATER'], ['COFFEE', 'BAGELS · DONUTS · TEA'], ['CHICKEN & RICE', 'GYRO · FALAFEL · KEBAB']][i];
    txt(t[0], w / 2, 36, 32, fg, w - 34); txt(t[1], w / 2, 66, 13, fg, w - 34, '600');
    g.fillStyle = '#e9e7df'; for (let k = 0; k < 4; k++) { g.fillRect(12 + k * 60, 90, 52, 30); txt('$' + (2 + ((k * 3 + i) % 6)) + '.' + (k % 2 ? '50' : '00'), 38 + k * 60, 106, 13, '#222', 46); }
    fade(w, h, 0.08); grime(w, h, 34, 90 + i);
  });
  fam('flyer', 96, 128, 4, 4, (g, i, w, h) => {
    g.fillStyle = ['#e9e6da', '#e4d36a', '#dfe3e6', '#e8b9a6'][i]; g.fillRect(0, 0, w, h);
    const t = [['LOST CAT', 'grey tabby · REWARD'], ['GUITAR', 'LESSONS'], ['ROOM', 'FOR RENT'], ['MOVING', 'SALE SAT']][i];
    txt(t[0], w / 2, 20, 16, '#151515', w - 10); txt(t[1], w / 2, 40, 10, '#151515', w - 10, '600');
    if (i === 0) { g.fillStyle = '#6d6a66'; g.beginPath(); g.ellipse(w / 2, 72, 20, 16, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(32, 62); g.lineTo(34, 46); g.lineTo(44, 58); g.fill(); g.beginPath(); g.moveTo(64, 62); g.lineTo(62, 46); g.lineTo(52, 58); g.fill(); }
    else { g.fillStyle = '#333'; for (let k = 0; k < 6; k++) g.fillRect(10, 52 + k * 7, (w - 20) * (0.5 + 0.5 * hsh(i, k, 3)), 2.5); }
    g.strokeStyle = '#444'; g.lineWidth = 1; for (let k = 1; k < 8; k++) { g.beginPath(); g.moveTo(k * 12, 100); g.lineTo(k * 12, h); g.stroke(); } g.beginPath(); g.moveTo(0, 100); g.lineTo(w, 100); g.stroke();
    g.fillStyle = 'rgba(190,180,150,0.5)'; g.fillRect(w / 2 - 14, 0, 28, 7); fade(w, h, 0.1); grime(w, h, 12, 100 + i);
  });
  fam('ped', 96, 96, 3, 3, (g, i, w, h) => {
    g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
    const hand = (col) => { g.fillStyle = col; rr(30, 44, 36, 34, 9); g.fill(); for (let k = 0; k < 4; k++) { rr(31 + k * 9, 16 + Math.abs(k - 1.5) * 4, 7.5, 34, 3.5); g.fill(); } g.save(); g.translate(28, 60); g.rotate(-0.6); rr(-5, -16, 9, 24, 4); g.fill(); g.restore(); };
    const man = (col) => { g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.beginPath(); g.arc(54, 17, 7, 0, TAU); g.fill(); g.lineWidth = 9; g.beginPath(); g.moveTo(51, 29); g.lineTo(46, 54); g.stroke(); g.lineWidth = 6.5; g.beginPath(); g.moveTo(47, 53); g.lineTo(60, 68); g.lineTo(62, 84); g.moveTo(46, 54); g.lineTo(38, 68); g.lineTo(27, 80); g.moveTo(51, 31); g.lineTo(65, 43); g.lineTo(74, 41); g.moveTo(50, 31); g.lineTo(37, 40); g.lineTo(32, 52); g.stroke(); };
    if (i === 0) hand('#ff6a10'); else if (i === 1) man('#eaf3ff'); else { hand('#2a1608'); }
    if (i === 2) { g.fillStyle = 'rgba(120,120,120,0.10)'; for (let k = 0; k < 12; k++) g.fillRect(0, k * 8, w, 1); }
  });
  fam('placard', 64, 96, 1, 1, (g, i, w, h) => { g.fillStyle = '#e8e6de'; g.fillRect(0, 0, w, h); g.strokeStyle = '#151515'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6); txt('PUSH', w / 2, 16, 12, '#151515', w - 10); txt('BUTTON', w / 2, 30, 11, '#151515', w - 10); txt('WAIT FOR', w / 2, 50, 9, '#151515', w - 10); txt('WALK', w / 2, 64, 13, '#151515', w - 10); txt('SIGNAL', w / 2, 80, 11, '#151515', w - 10); fade(w, h, 0.15); grime(w, h, 12, 111); });
  fam('oneway', 224, 72, 2, 2, (g, i, w, h) => {
    const dir = i ? -1 : 1; g.fillStyle = '#101010'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e8e8e4'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6);
    g.save(); g.translate(w / 2, h / 2); g.scale(dir, 1); g.fillStyle = '#f2f2ee'; g.beginPath(); g.moveTo(-96, -17); g.lineTo(52, -17); g.lineTo(52, -29); g.lineTo(102, 0); g.lineTo(52, 29); g.lineTo(52, 17); g.lineTo(-96, 17); g.closePath(); g.fill(); g.restore();
    txt('ONE WAY', w / 2 - 20 * dir, h / 2 + 1, 25, '#101010', 130); fade(w, h, 0.1); grime(w, h, 14, 120 + i);
  });
  fam('sticker', 64, 64, 32, 8, (g, i, w, h) => {
    g.clearRect(0, 0, w, h); const k = i % 8, hue = (i * 47) % 360, col = `hsl(${hue},${45 + (i * 13) % 40}%,${38 + (i * 7) % 30}%)`;
    if (k === 0) { g.fillStyle = '#e9e7df'; rr(4, 12, 56, 40, 4); g.fill(); g.fillStyle = '#c0392b'; g.fillRect(4, 12, 56, 13); txt('HELLO', 32, 19, 9, '#fff', 50); g.strokeStyle = '#1a1a1a'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(10, 42); g.bezierCurveTo(20, 26, 26, 52, 36, 34); g.bezierCurveTo(42, 28, 46, 48, 56, 36); g.stroke(); }
    else if (k === 1) { g.fillStyle = col; g.beginPath(); g.arc(32, 32, 26, 0, TAU); g.fill(); g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(32, 32, 16, 0, TAU); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(32, 32, 7, 0, TAU); g.fill(); }
    else if (k === 2) { g.fillStyle = '#111'; g.fillRect(6, 18, 52, 28); txt(['NO SLEEP', 'LOUD', 'RIOT CLUB', 'ECHO'][(i >> 3) % 4], 32, 32, 11, '#f2f2f2', 46); }
    else if (k === 3) { g.fillStyle = '#e8e4d2'; g.fillRect(8, 6, 48, 52); g.fillStyle = '#222'; for (let q = 0; q < 7; q++) g.fillRect(12, 12 + q * 6, 40 * (0.5 + 0.5 * hsh(i, q)), 2); g.fillStyle = col; g.fillRect(12, 46, 40, 8); }
    else if (k === 4) { g.fillStyle = col; rr(5, 16, 54, 32, 8); g.fill(); txt(['VOTE', 'LOCAL', 'RIDE', 'FIX IT'][(i >> 3) % 4], 32, 33, 15, '#fff', 46); }
    else if (k === 5) { g.strokeStyle = ['#151515', '#b3261e', '#1b3d8a', '#e9e9e2'][(i >> 3) % 4]; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(8, 44); g.bezierCurveTo(14, 8, 26, 58, 30, 20); g.bezierCurveTo(34, 6, 44, 60, 50, 22); g.lineTo(58, 40); g.stroke(); }
    else if (k === 6) { g.fillStyle = '#e3c23a'; g.fillRect(8, 14, 48, 36); g.fillStyle = '#111'; for (let q = 0; q < 5; q++) { g.beginPath(); g.moveTo(8 + q * 12, 50); g.lineTo(14 + q * 12, 50); g.lineTo(26 + q * 12, 14); g.lineTo(20 + q * 12, 14); g.fill(); } }
    else { g.fillStyle = 'rgba(214,208,190,0.9)'; g.beginPath(); g.moveTo(8, 10); g.lineTo(54, 14); g.lineTo(50, 30); g.lineTo(56, 52); g.lineTo(22, 50); g.lineTo(10, 56); g.closePath(); g.fill(); g.fillStyle = 'rgba(60,60,60,0.5)'; g.fillRect(16, 22, 26, 2); g.fillRect(16, 30, 18, 2); }
    g.fillStyle = 'rgba(205,200,185,0.22)'; g.globalCompositeOperation = 'source-atop'; g.fillRect(0, 0, w, h); grime(w, h, 6, 130 + i); g.globalCompositeOperation = 'source-over';
  });
  fam('stripe', 256, 32, 1, 1, (g, i, w, h) => { g.fillStyle = '#e9e7df'; g.fillRect(0, 0, w, h); g.fillStyle = '#e06a1c'; for (let k = -1; k < 9; k++) { g.beginPath(); g.moveTo(k * 32, h); g.lineTo(k * 32 + 16, h); g.lineTo(k * 32 + 48, 0); g.lineTo(k * 32 + 32, 0); g.fill(); } fade(w, h, 0.1); grime(w, h, 20, 170); });
  fam('board', 256, 96, 3, 3, (g, i, w, h) => {
    const bg = ['#e9e6dc', '#1d3a63', '#e3c23a'][i], fg = ['#1c1c1c', '#f2f0e6', '#151515'][i]; g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(5, 5, w - 10, h - 10);
    txt(['HARBOR & SONS', 'NORTHGATE BUILDERS', 'KEYSTONE RESTORATION'][i], w / 2, 32, 24, fg, w - 26); txt(['GENERAL CONTRACTORS', 'CONSTRUCTION MANAGEMENT', 'FACADE · ROOFING · MASONRY'][i], w / 2, 56, 12, fg, w - 30, '600'); txt('212-555-01' + (40 + i * 17), w / 2, 77, 14, fg, w - 60); fade(w, h, 0.1); grime(w, h, 40, 300 + i);
  });
  fam('ply', 128, 128, 1, 1, (g, i, w, h) => { g.fillStyle = '#b89a6a'; g.fillRect(0, 0, w, h); for (let k = 0; k < 90; k++) { g.fillStyle = `rgba(${90 + hsh(k, 1) * 60 | 0},${60 + hsh(k, 2) * 40 | 0},${30 + hsh(k, 3) * 20 | 0},${0.05 + 0.1 * hsh(k, 4)})`; g.fillRect(0, hsh(k, 5) * h, w, 1 + hsh(k, 6) * 3); }
    g.fillStyle = 'rgba(40,28,14,0.8)'; g.fillRect(63, 0, 2, h); g.fillRect(0, 0, w, 1.5); g.fillRect(0, h - 1.5, w, 1.5); for (let k = 0; k < 6; k++) { g.fillStyle = `rgba(50,40,25,${0.1 + 0.15 * hsh(k, 7)})`; g.beginPath(); g.ellipse(hsh(k, 8) * w, hsh(k, 9) * h, 6 + hsh(k, 10) * 14, 4 + hsh(k, 11) * 9, hsh(k, 12) * 3, 0, TAU); g.fill(); } });
  fam('mesh', 64, 64, 1, 1, (g, i, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = '#e4e6e6'; g.lineWidth = 4.4; g.beginPath(); for (let k = 0; k < 8; k++) { g.moveTo(k * 8 + 4, 0); g.lineTo(k * 8 + 4, h); g.moveTo(0, k * 8 + 4); g.lineTo(w, k * 8 + 4); } g.stroke(); });
  fam('white', 32, 32, 1, 1, (g, i, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(-4, -4, w + 8, h + 8); });
  fam('blade', 256, 48, names.length, 7, (g, i, w, h) => {
    g.fillStyle = '#0c6a45'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e9efe9'; g.lineWidth = 2; g.strokeRect(3, 3, w - 6, h - 6); txt(names[i], w / 2, h / 2 + 1, 31, '#f3f6f1', w - 24); fade(w, h, 0.07); grime(w, h, 8, 200 + i);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex: t, cells };
}

// ------------------------------------------------------------------------------------------------ materials
const FRAG_COMMON = /* glsl */`
  varying vec3 vWPos; varying vec4 vFw;
  uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter;
  vec3 bakeV; vec3 bakeN; float fRust; float fBase; vec3 fEmit;
  float fH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float fN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(fH(i), fH(i+vec2(1,0)), f.x), mix(fH(i+vec2(0,1)), fH(i+vec2(1,1)), f.x), f.y); }`;
// mode 'f': the modelled pieces (vertex colour, atlas, per-vertex wear). mode 's': a scanned prop (own textures; base dirt and bake only).
function patch(m, shared, mode, extra = '') {
  const f = mode === 'f';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec4 vFw; ${f ? 'attribute vec4 aW; attribute vec3 aTint; attribute vec2 aCell;' : ''}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        ${f ? `#ifdef USE_MAP
          vMapUv += aCell * aW.z;
        #endif` : ''}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        ${f ? 'vColor.rgb *= mix(vec3(1.0), aTint, aW.w);' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 fP = vec4(transformed, 1.0); vec4 fO = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          fP = instanceMatrix * fP; fO = instanceMatrix * fO;
        #endif
        fP = modelMatrix * fP; fO = modelMatrix * fO; vWPos = fP.xyz; vFw = vec4(${f ? 'aW.x, aW.y' : '0.0, 0.0'}, fP.y - fO.y, 0.0); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_COMMON)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wp = vWPos; bakeV = texture2D(tLight, vec2(wp.x / (2.0 * uHalf.x) + 0.5, -wp.z / (2.0 * uHalf.y) + 0.5)).rgb; bakeN = vec3(0.0, 1.0, 0.0);
          float n1 = fN(vec2((wp.x + wp.z * 0.73) * 13.0, wp.y * 0.55));
          float n2 = fN(vec2(wp.x * 2.3 + wp.z * 1.7, wp.y * 2.1 + wp.z * 0.9));
          float n3 = fN(vec2((wp.x - wp.z) * 23.0, wp.y * 19.0 + wp.x * 7.0));
          ${extra}
          ${f ? `
          diffuseColor.rgb *= 0.74 + 0.2 * n2 + 0.16 * n1;
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 1.06, 0.22 * n2);          // sun fade
          fRust = smoothstep(0.86 - vFw.x * 0.5, 0.98 - vFw.x * 0.45, n2 * 0.55 + n3 * 0.45);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.045, 0.026) * (0.6 + 0.8 * n3), fRust * 0.8);
          float chip = step(0.9, fN(wp.xy * 67.0 + wp.z * 43.0)) * step(0.5, n2) * (1.0 - vFw.y) * step(0.02, vFw.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.19, 0.185), chip * 0.55);` : `
          diffuseColor.rgb *= 0.86 + 0.2 * n2; fRust = 0.0;`}
          fBase = smoothstep(0.5, 0.0, vFw.z) * (0.35 + 0.65 * n2) + 0.25 * smoothstep(0.62, 0.9, n1 * n2 * 2.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.054, 0.047), clamp(fBase, 0.0, 1.0) * 0.62);
          fEmit = diffuseColor.rgb * max(0.0, -vFw.x);
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += fEmit;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.3 * fRust + 0.3 * fBase, 0.2, 1.0);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${f ? 'metalnessFactor = vFw.y * (1.0 - fRust) * (1.0 - 0.6 * clamp(fBase, 0.0, 1.0));' : ''}`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + BAKE_LIGHT_GLSL);
  };
  const key = 'stfurn4' + mode + extra.length + (m.transparent ? 't' : 'o');
  m.customProgramCacheKey = () => key;
  return m;
}

// ------------------------------------------------------------------------------------------------ prototype builder
const GAL = { w: [0.2, 0.55] }, PAINT = { w: [0.3, 0] }, IRON = { w: [0.36, 0.25] }, PLAIN = { w: [0, 0] }, STEEL = { w: [0.12, 0.7] };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
class PB {
  constructor(atlas) { this.A = atlas; this.list = []; }
  push(geo, col, o = {}, m = null) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
    const P = g.attributes.position, n = P.count, c = new Float32Array(n * 3), w = new Float32Array(n * 4), W = o.w || [0.15, 0];
    const uv = g.attributes.uv ? g.attributes.uv.array : new Float32Array(n * 2), cell = this.A.cells[o.cell || 'white'], tex = !!o.cell;
    for (let i = 0; i < n; i++) {
      let cc = col;
      if (o.colFn) { const t = i - (i % 3); cc = o.colFn((P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3, (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3, (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3) || col; }
      c[i * 3] = cc[0]; c[i * 3 + 1] = cc[1]; c[i * 3 + 2] = cc[2];
      w[i * 4] = W[0]; w[i * 4 + 1] = W[1]; w[i * 4 + 2] = o.vary ? 1 : 0; w[i * 4 + 3] = o.tint ? 1 : 0;
      if (tex) { uv[i * 2] = cell.u0 + uv[i * 2] * (cell.u1 - cell.u0) + (o.ci || 0) * cell.du; uv[i * 2 + 1] = cell.v0 + uv[i * 2 + 1] * (cell.v1 - cell.v0) + (o.cj || 0) * cell.dv; }
      else { uv[i * 2] = (cell.u0 + cell.u1) / 2; uv[i * 2 + 1] = (cell.v0 + cell.v1) / 2; }
    }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', P); out.setAttribute('normal', g.attributes.normal); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(c, 3)); out.setAttribute('aW', new THREE.BufferAttribute(w, 4));
    this.list.push(out); return this;
  }
  mat(c, o = {}, s = ONE) { _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e); return _m.compose(V(c), _q, s).clone(); }
  cyl(a, b, r0, r1, col, o = {}) {
    const va = V(a), vb = V(b), d = vb.clone().sub(va), len = d.length(); const g = new THREE.CylinderGeometry(r1, r0, len, o.seg || 8, 1, !o.cap); if (o.spin) g.rotateY(o.spin);
    _q.setFromUnitVectors(UP, d.normalize()); return this.push(g, col, o, _m.compose(va.add(vb).multiplyScalar(0.5), _q, ONE).clone());
  }
  box(c, s, col, o = {}) { return this.push(new THREE.BoxGeometry(s[0], s[1], s[2]), col, o, this.mat(c, o)); }
  tube(pts, r, col, o = {}) { return this.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(V), false, 'catmullrom', o.tension ?? 0.5), o.n || pts.length * 3, r, o.seg || 6, false), col, o); }
  lathe(prof, col, o = {}) { const g = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p[0], p[1])), o.seg || 10); if (o.spin) g.rotateY(o.spin); return this.push(g, col, o, this.mat(o.at || [0, 0, 0], o)); }
  sph(c, r, col, o = {}) { const s = typeof r === 'number' ? new THREE.Vector3(r, r, r) : V(r); return this.push(new THREE.SphereGeometry(1, o.seg || 8, o.rings || 6), col, o, this.mat(c, o, s)); }
  // a flat face from the atlas, facing +Z unless turned (ry = PI/2 faces +X); double: a readable back face too
  quad(cell, c, w, h, o = {}) {
    const off = o.double ? 0.004 : 0, m = this.mat(c, o), nz = new THREE.Vector3(0, 0, 1).transformDirection(m);
    this.push(new THREE.PlaneGeometry(w, h), o.col || WHITE, Object.assign({ w: [0.05, 0] }, o, { cell }), this.mat([c[0] + nz.x * off, c[1] + nz.y * off, c[2] + nz.z * off], o));
    if (o.double) { const o2 = Object.assign({}, o, { ry: (o.ry || 0) + PI }); if (o.back !== undefined) { if (o.back === null) { o2.col = o.backCol || C('#7d8182'); return this.push(new THREE.PlaneGeometry(w, h), o2.col, { w: [0.1, 0.4] }, this.mat([c[0] - nz.x * off, c[1] - nz.y * off, c[2] - nz.z * off], o2)); } Object.assign(o2, o.back); }
      this.push(new THREE.PlaneGeometry(w, h), o2.col || WHITE, Object.assign({ w: [0.05, 0] }, o2, { cell: o2.cell || cell }), this.mat([c[0] - nz.x * off, c[1] - nz.y * off, c[2] - nz.z * off], o2)); }
    return this;
  }
  // a patch of the atlas wrapped on a vertical pole of radius r, centred at height y and angle ang (0 = +Z, PI/2 = +X)
  wrap(cell, r, y, ang, w, h, o = {}) { const g = new THREE.CylinderGeometry(r, r, h, 4, 1, true, ang - w / (2 * r), w / r); return this.push(g, o.col || WHITE, Object.assign({ w: [0.05, 0] }, o, { cell }), this.mat([o.x || 0, y, o.z || 0])); }
  merge(pb, m) { for (const g of pb.list) { const c = g.clone(); c.applyMatrix4(m); this.list.push(c); } return this; }
  build() { const g = mergeGeometries(this.list, false); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
// lumps: push the vertices of a geometry in and out by a hash of where they are, then shade it faceted
function lumpy(geo, amp, freq = 3, seed = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + amp * (hsh(Math.round(x * 97), Math.round(y * 97) + seed, Math.round(z * 97)) - 0.5) * 2 + amp * Math.sin(x * freq + seed) * Math.cos(z * freq * 1.3 + y * freq); P.setXYZ(i, x * k, y * k, z * k); }
  g.computeVertexNormals(); return g;
}

// the same lumps kept smooth: neighbouring faces stay joined and the shading does not facet
function lumpySmooth(geo, amp, seed = 0) {
  const P = geo.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = 1 + amp * (hsh(Math.round(x * 97), Math.round(y * 97) + seed, Math.round(z * 97)) - 0.5) * 2 + amp * Math.sin(x * 5 + seed) * Math.cos(z * 6 + y * 4); P.setXYZ(i, x * k, y * k, z * k); }
  geo.computeVertexNormals(); return geo;
}
// ------------------------------------------------------------------------------------------------ the prototypes
function buildProtos(A) {
  const P = {}, pb = () => new PB(A);
  const cGalv = C('#8d9190'), cGalvD = C('#6c7070'), cYel = C('#dba514'), cYelD = C('#b98a10'), cBlk = C('#111213'), cConc = C('#77736a'), cIron = C('#15171a');
  const stickers = (b, r, n, seed, y0 = 0.9, y1 = 2.3) => { for (let i = 0; i < n; i++) { const fl = hsh(seed, i, 9) < 0.22, s = fl ? 0.14 : 0.055 + 0.05 * hsh(seed, i, 1); b.wrap(fl ? 'flyer' : 'sticker', r + 0.003, y0 + (y1 - y0) * hsh(seed, i, 2), hsh(seed, i, 3) * TAU, fl ? s * 0.75 : s, s, { vary: !fl, ci: fl ? i % 4 : i % 4, cj: fl ? 0 : i % 2 }); } };
  // the cast base, footing and shaft every city pole stands on
  const pole = (b0, top, r0, r1, seed, bs = 1) => { const b = bs === 1 ? b0 : pb();
    const cast = C('#3a3c3e'), CI = { w: [0.5, 0.35] };
    b.cyl([0, 0, 0], [0, 0.02, 0], 0.5, 0.48, cConc, { w: [0.2, 0], seg: 10, cap: true }); b.box([0, 0.036, 0], [0.68, 0.032, 0.68], C('#35373a'), { w: [0.6, 0.35] });
    for (const [x, z] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) { b.cyl([x, 0.05, z], [x, 0.1, z], 0.034, 0.034, C('#2e241c'), { w: [0.9, 0.2], seg: 6, cap: true }); b.cyl([x, 0.1, z], [x, 0.14, z], 0.014, 0.014, C('#3b2a1e'), { w: [0.9, 0.2], seg: 5, cap: true }); }
    b.lathe([[0.31, 0.02], [0.31, 0.06], [0.275, 0.08], [0.275, 0.13], [0.24, 0.21], [0.22, 0.55], [0.232, 0.56], [0.232, 0.6], [0.215, 0.61], [0.2, 0.86], [0.175, 0.93], [r0 + 0.014, 0.97]], cast, { w: [0.5, 0.35], seg: 8, spin: PI / 8 });
    for (let k = 0; k < 8; k++) { const a = k * PI / 4; b.box([0.2 * Math.cos(a), 0.4, 0.2 * Math.sin(a)], [0.05, 0.36, 0.028], C('#333537'), { w: [0.5, 0.35], ry: -a + PI / 2 }); }
    b.box([0, 0.38, -0.215], [0.15, 0.25, 0.022], C('#55585a'), CI); for (const [x, y] of [[0.06, 0.48], [-0.06, 0.48], [0.06, 0.28], [-0.06, 0.28]]) b.box([x, y, -0.213], [0.016, 0.016, 0.01], C('#1b1c1d'), CI);
    for (let k = 0; k < 4; k++) { const a = PI / 4 + k * PI / 2, x = 0.275 * Math.cos(a), z = 0.275 * Math.sin(a); b.cyl([x, 0.05, z], [x, 0.115, z], 0.024, 0.024, C('#2e241c'), { w: [0.9, 0.2], seg: 6, cap: true }); b.cyl([x, 0.115, z], [x, 0.145, z], 0.011, 0.011, C('#3b2a1e'), { w: [0.9, 0.2], seg: 5, cap: true }); }
    if (b !== b0) b0.merge(b, new THREE.Matrix4().makeScale(bs, bs, bs));
    b0.cyl([0, 0.97 * bs, 0], [0, top, 0], r0, r1, cGalv, Object.assign({ seg: 8, spin: PI / 8 }, GAL)); if (bs !== 1) { b0.wrap('sticker', r0 + 0.004, 1.72, PI * 0.5 + seed, 0.08, 0.11, { col: C('#d8d4c4'), ci: 7, cj: 3 }); return; }
    
    b.cyl([0, 0.95, 0], [0, 1.02, 0], r0 + 0.016, r0 + 0.012, cast, { w: [0.5, 0.35], seg: 8, spin: PI / 8 });
    b.wrap('sticker', r0 + 0.004, 1.72, PI * 0.5 + seed, 0.08, 0.11, { col: C('#d8d4c4'), ci: 7, cj: 3 });   // the pole's number tag
  };
  // a three-section vehicle head; origin at the centre of the middle lens face, lenses face +X. R = lens radius
  const cHead = C('#f0aa00'), cHeadD = C('#c58a06'), HP = { w: [0.16, 0] };
  const head = (b, R, side) => {
    const s = R / 0.15, w = 0.345 * s, d = 0.27;
    for (let k = -1; k <= 1; k++) {
      b.box([-d / 2, k * w, 0], [d, w - 0.006, w - 0.012], cHead, HP); b.box([-d - 0.016, k * w, 0], [0.032, w * 0.84, w * 0.82], cHeadD, HP); b.box([-d / 2, k * w + w / 2, 0], [d + 0.006, 0.012, w - 0.004], C('#6e4d05'), HP);
      const lc = k === 1 ? C('#3c0d0a') : k === 0 ? C('#3b2a07') : C('#07301f'); const lens = new THREE.CircleGeometry(R * 0.93, 14); lens.rotateY(PI / 2); b.push(lens, lc, { w: [0, 0.3] }, b.mat([0.003, k * w, 0]));
      const v1 = new THREE.CylinderGeometry(R * 1.04, R * 1.1, 0.3, 12, 1, true, PI * 0.78, PI * 1.44); v1.rotateZ(-PI / 2); b.push(v1, cHead, HP, b.mat([0.15, k * w, 0]));
      const v2 = new THREE.CylinderGeometry(R * 1.0, R * 1.06, 0.296, 12, 1, true, PI * 0.78, PI * 1.44); v2.rotateZ(-PI / 2); b.push(v2, C('#0c0c0c'), PLAIN, b.mat([0.148, k * w, 0]));
    }
    const top = 1.5 * w, yb = top + 0.07;
    if (side) for (const y of [yb - 0.03, -yb + 0.03]) { b.cyl([-d / 2, y, 0], [-d / 2, y, side * 0.44], 0.026, 0.026, cHeadD, HP); b.cyl([-d / 2, y - 0.05, 0], [-d / 2, y + 0.05, 0], 0.032, 0.032, cHeadD, HP); }
    else { b.cyl([-0.36, -yb, 0], [-0.36, yb, 0], 0.024, 0.024, cGalvD, GAL); for (const y of [yb, -yb]) { b.cyl([-0.36, y, 0], [-d / 2, y, 0], 0.024, 0.024, cGalvD, GAL); b.cyl([-d / 2, y, 0], [-d / 2, y - Math.sign(y) * 0.075, 0], 0.032, 0.032, cHeadD, HP); } }
  };
  const pedHead = (b) => {   // origin at the face centre, facing +X
    const pk = cHeadD, PK = HP; b.box([-0.09, 0, 0], [0.18, 0.44, 0.44], pk, PK); b.box([-0.19, 0, 0], [0.02, 0.36, 0.36], pk, PK);
    for (const [y, z, sy, sz] of [[0.2, 0, 0.02, 0.44], [-0.2, 0, 0.02, 0.44], [0, 0.21, 0.42, 0.02], [0, -0.21, 0.42, 0.02]]) b.box([0.08, y, z], [0.16, sy, sz], pk, PK);
    b.quad('ped', [0.004, 0, 0], 0.38, 0.38, { ry: PI / 2, ci: 2, w: [0, 0.2] });
  };
  // ---- signal pole with mast arm; L = arm length. Returns where the lenses and pedestrian faces are, for the lit lamps
  const armYof = (L) => (z) => 5.2 + 1.1 * (1 - Math.pow(1 - Math.min(1, z / L), 2.3));
  const signal = (L, seed) => {
    const b = pb(), armY = armYof(L), TOP = 6.95, pr = (y) => 0.14 - 0.042 * (y - 0.97) / (TOP - 0.97);
    pole(b, TOP, 0.14, 0.098, seed); b.sph([0, TOP, 0], [0.1, 0.06, 0.1], cGalvD, GAL);
    // the arm: thick at the pole, tapering and curving up to the tip
    const NS = 10; for (let k = 0; k < NS; k++) { const z0 = Math.max(0.06, L * k / NS), z1 = L * (k + 1) / NS; b.cyl([0, armY(z0), z0], [0, armY(z1), z1], 0.098 - 0.046 * k / NS, 0.098 - 0.046 * (k + 1) / NS, cGalv, Object.assign({ seg: 8 }, GAL)); }
    b.cyl([0, 5.02, 0], [0, 5.4, 0], pr(5.1) + 0.02, pr(5.3) + 0.018, cGalvD, { w: [0.45, 0.4], seg: 8, spin: PI / 8 }); b.box([0, 5.22, 0.15], [0.26, 0.3, 0.06], cGalvD, { w: [0.5, 0.4] });
    for (const [x, y] of [[0.09, 5.32], [-0.09, 5.32], [0.09, 5.12], [-0.09, 5.12]]) b.box([x, y, 0.185], [0.03, 0.03, 0.02], C('#3a3d3d'), { w: [0.7, 0.4] });
    b.sph([0, armY(L), L], 0.054, cGalvD, GAL);
    const gz = L * 0.6, gy = armY(gz) + 0.06; b.cyl([0, TOP - 0.1, 0.05], [0, gy, gz], 0.022, 0.022, cGalvD, { w: [0.3, 0.5], seg: 6 });
    b.box([0, (TOP - 0.1) * 0.5 + gy * 0.5, gz * 0.5], [0.035, 0.035, 0.26], cGalvD, { w: [0.6, 0.4], rx: Math.atan2(TOP - 0.1 - gy, gz) }); b.box([0, gy - 0.02, gz], [0.14, 0.06, 0.08], cGalvD, { w: [0.5, 0.4] }); b.box([0, TOP - 0.1, 0.07], [0.17, 0.07, 0.09], cGalvD, { w: [0.5, 0.4] });
    const heads = [], place = (h, x, y, z, yaw, s) => { b.merge(h, new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); heads.push({ x, y, z, yaw, s }); };
    [[L - 0.32, -0.16], [L - 2.9, 0.2]].forEach(([z, yaw]) => { const h = pb(); head(h, 0.15, 0); const y = armY(z) - 0.2; place(h, 0.36, y, z, yaw, 1); b.box([0, armY(z), z], [0.14, 0.14, 0.12], cGalvD, { w: [0.5, 0.4] });
      b.tube([[0, armY(z) - 0.06, z - 0.3], [0.1, armY(z) - 0.3, z - 0.2], [0.24, y + 0.62, z - 0.05]], 0.011, C('#0d0d0e'), { n: 6, seg: 4, w: [0, 0] }); });
    { const h = pb(); head(h, 0.105, 1); place(h, 0.135, 4.5, -0.44, 0.1, 0.7); }
    // a conduit up the back of the pole, a junction box, straps
    b.cyl([-pr(1) - 0.012, 1.0, 0.03], [-pr(5) - 0.012, 5.0, 0.03], 0.018, 0.018, cGalvD, { w: [0.5, 0.5], seg: 5 }); b.box([-pr(2.95) - 0.05, 2.95, 0.03], [0.1, 0.22, 0.14], cGalvD, { w: [0.5, 0.4] });
    for (const y of [1.45, 2.2, 3.4, 4.2]) b.cyl([0, y, 0], [0, y + 0.028, 0], pr(y) + 0.006, pr(y) + 0.006, C('#3a3d3d'), { w: [0.5, 0.5], seg: 8, spin: PI / 8 });
    b.tube([[-pr(4.3), 4.3, 0.03], [-0.15, 4.6, -0.2], [0, 4.9, -0.44]], 0.011, C('#0d0d0e'), { n: 6, seg: 4, w: [0, 0] });
    if (L > 7) { b.cyl([0, armY(L * 0.8), L * 0.8], [0, armY(L * 0.8) + 0.3, L * 0.8], 0.02, 0.02, cGalvD, GAL); b.box([0.06, armY(L * 0.8) + 0.36, L * 0.8], [0.3, 0.11, 0.12], C('#c9cbc8'), { w: [0.15, 0.1], rz: -0.25 }); b.box([0.2, armY(L * 0.8) + 0.325, L * 0.8], [0.02, 0.08, 0.1], C('#0b0b0c'), PLAIN); }
    // pedestrian heads: A faces +X on the sidewalk side, B faces +Z (across the approach) on the +X side
    const peds = [{ x: 0.14, y: 2.47, z: -0.38, ry: 0 }, { x: 0.38, y: 2.47, z: 0.14, ry: -PI / 2 }];
    for (const q of peds) { const h = pb(); pedHead(h); b.merge(h, new THREE.Matrix4().makeRotationY(q.ry).setPosition(q.x, q.y, q.z)); }
    for (const y of [2.62, 2.32]) { b.cyl([0, y, 0], [0, y, -0.38], 0.024, 0.024, cGalvD, GAL); b.cyl([0, y, 0], [0.38, y, 0], 0.024, 0.024, cGalvD, GAL); }
    b.cyl([0.38, 2.25, 0], [0.38, 2.69, 0], 0.026, 0.026, cGalvD, GAL); b.cyl([0, 2.25, -0.38], [0, 2.69, -0.38], 0.026, 0.026, cGalvD, GAL);
    // push button and its placard, stickers, flyers
    b.wrap('placard', pr(1.4) + 0.004, 1.42, PI * 0.25, 0.12, 0.17); b.box([0.1, 1.2, 0.1], [0.075, 0.12, 0.075], cGalvD, { w: [0.5, 0.4], ry: PI / 4 }); b.sph([0.132, 1.2, 0.132], 0.02, C('#b9bcbc'), STEEL);
    stickers(b, pr(1.6) + 0.003, 14, seed, 1.05, 2.3);
    return { geo: b.build(), heads, peds, armY };
  };
  P.sigS = signal(5.6, 1); P.sigL = signal(8.2, 2);
  for (const [nm, L] of [['sigLodS', 5.6], ['sigLodL', 8.2]]) { const b = pb(), aY = armYof(L); b.cyl([0, 0, 0], [0, 0.95, 0], 0.26, 0.2, C('#4a4d4f'), { seg: 8, w: [0.4, 0.3] }); b.cyl([0, 0.95, 0], [0, 6.95, 0], 0.14, 0.098, cGalv, { seg: 6, w: [0.2, 0.5] });
    for (let k = 0; k < 5; k++) b.cyl([0, aY(L * k / 5), L * k / 5], [0, aY(L * (k + 1) / 5), L * (k + 1) / 5], 0.12 - 0.01 * k, 0.11 - 0.01 * k, cGalvD, { seg: 5, w: [0.2, 0.4] });
    b.cyl([0, 6.85, 0.05], [0, aY(L * 0.6) + 0.06, L * 0.6], 0.016, 0.016, cGalvD, { seg: 3, w: [0.3, 0.5] });
    for (const [x, y, z, s, yaw] of [[0.36, aY(L - 0.32) - 0.2, L - 0.32, 1, -0.16], [0.36, aY(L - 2.9) - 0.2, L - 2.9, 1, 0.2], [0.135, 4.5, -0.44, 0.7, 0.1]]) { const h = pb(), w = 0.345 * s;
      h.box([-0.135, 0, 0], [0.27, 3 * w, w - 0.012], cHead, HP); h.box([-0.29, 0, 0], [0.03, 2.6 * w, 0.8 * w], cHeadD, HP);
      for (let k = -1; k <= 1; k++) { h.box([0.004, k * w, 0], [0.008, w * 0.8, w * 0.8], C('#0d0b06'), PLAIN); h.box([0.13, k * w + w * 0.42, 0], [0.26, 0.02, w * 0.9], cHead, HP); for (const sg of [-1, 1]) h.box([0.13, k * w + 0.1 * w, sg * w * 0.45], [0.26, w * 0.64, 0.02], cHead, HP); }
      b.merge(h, new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); if (s === 1) b.cyl([0, y - 0.6, z], [0, y + 0.6, z], 0.024, 0.024, cGalvD, { seg: 3, w: [0.3, 0.5] }); }
    for (const [x, z, ry] of [[0.14, -0.38, 0], [0.38, 0.14, -PI / 2]]) { const h = pb(); h.box([-0.09, 0, 0], [0.18, 0.44, 0.44], cHeadD, HP); h.box([0.004, 0, 0], [0.008, 0.36, 0.36], C('#0d0b06'), PLAIN); b.merge(h, new THREE.Matrix4().makeRotationY(ry).setPosition(x, 2.47, z)); }
    P[nm] = b.build(); }
  for (const [nm, L] of [['sigShS', 5.6], ['sigShL', 8.2]]) { const b = pb(), aY = armYof(L); b.cyl([0, 0, 0], [0, 6.95, 0], 0.15, 0.1, WHITE, { seg: 5 }); for (let k = 0; k < 3; k++) b.cyl([0, aY(L * k / 3), L * k / 3], [0, aY(L * (k + 1) / 3), L * (k + 1) / 3], 0.09, 0.07, WHITE, { seg: 4 });
    for (const [x, y, z, sc] of [[0.25, aY(L - 0.32) - 0.2, L - 0.32, 1], [0.25, aY(L - 2.9) - 0.2, L - 2.9, 1], [0.05, 4.5, -0.44, 0.7], [0.1, 2.47, -0.2, 0.42]]) b.box([x, y, z], [0.5, 1.04 * sc, 0.36 * sc], WHITE); P[nm] = b.build(); }
  // street-name blade (cantilevered from the pole along its own street) and the one-way plate strapped below
  { const b = pb(); b.quad('blade', [0.62, 0.11, 0], 0.92, 0.2, { double: true, vary: true }); b.box([0.62, 0.222, 0], [0.96, 0.024, 0.02], cGalvD, GAL); b.box([0.62, -0.002, 0], [0.96, 0.024, 0.02], cGalvD, GAL); b.box([0.135, 0.11, 0], [0.05, 0.25, 0.03], cGalvD, GAL);
    b.cyl([0, 0.03, 0], [0, 0.19, 0], 0.132, 0.13, cGalvD, { w: [0.5, 0.5], seg: 8, spin: PI / 8 }); P.blade = b.build(); }
  { const b = pb(); b.quad('oneway', [0, 0.15, 0.15], 0.92, 0.3, { double: true, back: { ci: 1 } });
    for (const y of [0.06, 0.24]) { b.cyl([0, y, 0], [0, y + 0.03, 0], 0.134, 0.134, cGalvD, { w: [0.5, 0.5], seg: 8, spin: PI / 8 }); b.box([0, y + 0.015, 0.138], [0.07, 0.035, 0.03], cGalvD, GAL); } P.oneway = b.build(); }
  { const b = pb(), aY = P.sigL.armY, y = aY(3.6) - 0.3; b.quad('blade', [0.1, y, 3.6], 0.92, 0.2, { ry: PI / 2, double: true, vary: true }); for (const dy of [0.112, -0.112]) b.box([0.1, y + dy, 3.6], [0.03, 0.03, 0.97], cGalvD, GAL); for (const dz of [0.475, -0.475]) b.box([0.1, y, 3.6 + dz], [0.03, 0.24, 0.03], cGalvD, GAL);
    for (const z of [3.3, 3.9]) { b.cyl([0.1, y + 0.11, z], [0, aY(z), z], 0.022, 0.022, cGalvD, GAL); b.box([0, aY(z), z], [0.2, 0.07, 0.08], C('#3a3d3d'), GAL); } P.armsign = b.build(); }
  // a regulation plate strapped to a round pole (plate faces +X)
  for (const [nm, rp] of [['psignP', 0.142], ['psignL', 0.108]]) { const b = pb(); b.quad('park', [rp + 0.023, 0, 0], 0.3, 0.45, { ry: PI / 2, double: true, back: null, vary: true }); for (const y of [0.15, -0.15]) { b.cyl([0, y, 0], [0, y + 0.025, 0], rp, rp, C('#3a3d3d'), { w: [0.5, 0.5], seg: 8, spin: PI / 8 }); b.box([rp + 0.008, y + 0.012, 0], [0.03, 0.03, 0.06], cGalvD, GAL); } P[nm] = b.build(); }
  // controller cabinet on the back of a pole
  { const b = pb(); b.box([-0.33, 1.85, 0], [0.3, 0.78, 0.5], C('#84898b'), { w: [0.35, 0.3] }); b.quad('cab', [-0.482, 1.85, 0], 0.46, 0.72, { ry: -PI / 2, w: [0.3, 0.2] }); b.box([-0.33, 2.25, 0], [0.34, 0.03, 0.54], C('#6f7476'), { w: [0.5, 0.3] });
    for (const y of [1.6, 2.1]) b.cyl([0, y, 0], [0, y + 0.03, 0], 0.142, 0.142, C('#3a3d3d'), { w: [0.5, 0.5], seg: 8, spin: PI / 8 }); b.cyl([-0.32, 1.47, 0.12], [-0.3, 0.1, 0.1], 0.02, 0.02, cGalvD, { w: [0.6, 0.5], seg: 5 }); P.cab = b.build(); }
  // ---- street light: octagonal-base pole, davit arm, flat LED cobra head; banner rods on the avenue kind. +X = over the road
  const lamp = (ave, seed) => {
    const b = pb(), H = ave ? 8.4 : 7.4; pole(b, H, 0.108, 0.07, seed);
    b.tube([[0, H - 0.05, 0], [0.04, H + 0.6, 0], [0.5, H + 1.2, 0], [1.5, H + 1.42, 0], [2.45, H + 1.36, 0]], 0.048, cGalv, Object.assign({ n: 14, seg: 7 }, GAL));
    b.cyl([0, H - 0.2, 0], [0, H + 0.05, 0], 0.092, 0.075, cGalvD, { w: [0.4, 0.4], seg: 8 });
    b.sph([2.78, H + 1.33, 0], [0.4, 0.075, 0.17], C('#74797c'), { w: [0.25, 0.3], seg: 10, rings: 6 }); b.box([2.8, H + 1.272, 0], [0.5, 0.012, 0.22], C('#d9dccf'), { w: [0, 0.1] }); b.cyl([2.62, H + 1.39, 0], [2.62, H + 1.47, 0], 0.03, 0.03, C('#2d3033'), { seg: 6, cap: true });
    if (ave) for (const y of [5.2, 6.75]) { b.cyl([0, y, 0], [-0.95, y, 0], 0.022, 0.022, C('#2b2d2f'), { w: [0.4, 0.4], seg: 6 }); b.sph([-0.95, y, 0], 0.035, C('#2b2d2f'), IRON); b.cyl([-0.02, y - 0.22, 0], [-0.3, y, 0], 0.012, 0.012, C('#2b2d2f'), { w: [0.4, 0.4], seg: 4 }); b.cyl([0, y - 0.04, 0], [0, y + 0.04, 0], 0.094, 0.094, C('#2b2d2f'), { w: [0.5, 0.4], seg: 8 }); }
    for (const y of [1.5, 2.6]) b.cyl([0, y, 0], [0, y + 0.025, 0], 0.112 - y * 0.005, 0.112 - y * 0.005, C('#3a3d3d'), { w: [0.5, 0.5], seg: 8, spin: PI / 8 });
    stickers(b, 0.107, 10, seed + 5, 1.05, 2.3);
    return b.build();
  };
  P.lampA = lamp(true, 3); P.lampS = lamp(false, 4);
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.95, 0], 0.26, 0.2, C('#4a4d4f'), { seg: 8, w: [0.4, 0.3] }); b.cyl([0, 0.95, 0], [0, 8.4, 0], 0.108, 0.07, cGalv, { seg: 6, w: [0.2, 0.5] }); b.tube([[0, 8.35, 0], [0.5, 9.6, 0], [2.45, 9.76, 0]], 0.048, cGalv, { n: 5, seg: 4, w: [0.2, 0.5] }); b.box([2.8, 9.72, 0], [0.7, 0.1, 0.3], C('#74797c'), PLAIN); P.lampLod = b.build(); }
  { const b = pb(); b.quad('banner', [-0.58, 5.975, 0], 0.6, 1.5, { double: true, vary: true, w: [0, 0] }); for (const y of [5.2, 6.75]) for (const x of [-0.34, -0.82]) b.box([x, y + (y > 6 ? -0.03 : 0.03), 0], [0.03, 0.07, 0.02], C('#c9c6bc'), PLAIN); P.banner = b.build(); }
  // ---- sign post with footing; parking plate; bus stop
  { const b = pb(), pc = C('#73777a'), PW = { w: [0.5, 0.45] }; b.box([0, 0.008, 0], [0.2, 0.016, 0.2], C('#3f4142'), { w: [0.7, 0.3] }); for (const [x, z] of [[0.07, 0.07], [-0.07, 0.07], [0.07, -0.07], [-0.07, -0.07]]) b.cyl([x, 0.016, z], [x, 0.04, z], 0.014, 0.014, C('#2e241c'), { w: [0.9, 0.2], seg: 5, cap: true });
    b.box([0, 0.16, 0], [0.066, 0.3, 0.05], C('#55585a'), { w: [0.6, 0.4] }); b.box([0, 1.5, 0], [0.05, 3.0, 0.012], pc, PW); for (const x of [-0.022, 0.022]) b.box([x, 1.5, 0.012], [0.008, 3.0, 0.028], pc, PW);
    for (let k = 0; k < 12; k++) b.box([0, 0.5 + k * 0.2, -0.0065], [0.012, 0.012, 0.002], C('#17191a'), PLAIN);
    b.quad('sticker', [0, 1.25, -0.008], 0.05, 0.05, { ry: PI, ci: 2, cj: 1 }); b.quad('sticker', [0, 1.62, 0.028], 0.06, 0.06, { ci: 4, cj: 0 }); P.spost = b.build(); }
  { const b = pb(); b.quad('park', [0.03, 0, 0], 0.3, 0.45, { ry: PI / 2, double: true, back: null, vary: true }); b.box([0.038, 0.17, 0], [0.012, 0.02, 0.02], C('#9a9c9a'), STEEL); b.box([0.038, -0.17, 0], [0.012, 0.02, 0.02], C('#9a9c9a'), STEEL); P.psign = b.build(); }
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.02, 0], 0.14, 0.12, C('#5d5a54'), { w: [0, 0], seg: 8, cap: true }); b.cyl([0, 0, 0], [0, 3.25, 0], 0.036, 0.036, cGalv, Object.assign({ seg: 8, cap: true }, GAL));
    b.quad('bus', [0, 2.66, -0.3], 0.5, 1.0, { ry: PI / 2, double: true }); for (const y of [2.3, 3.0]) b.box([0, y, -0.03], [0.05, 0.03, 0.09], cGalvD, GAL);
    b.box([0, 1.45, 0.07], [0.13, 0.42, 0.1], C('#2c4f86'), PAINT); b.box([0, 1.45, 0.122], [0.1, 0.36, 0.004], C('#d9d8cf'), PLAIN); P.busstop = b.build(); }
  // ---- bus shelter: X along the kerb, +Z the roadway (open) side
  { const b = pb(), gl = pb(), fr = C('#3b3f42');
    for (const x of [-2.05, 2.05]) for (const z of [-0.65, 0.6]) b.box([x, 1.22, z], [0.07, 2.44, 0.07], fr, { w: [0.3, 0.4] });
    b.box([0, 2.5, 0], [4.4, 0.09, 1.65], C('#2c2f31'), { w: [0.25, 0.3] }); b.box([0, 2.42, -0.65], [4.2, 0.06, 0.06], fr, { w: [0.3, 0.4] }); b.box([0, 0.12, -0.65], [4.1, 0.05, 0.05], fr, { w: [0.4, 0.4] }); b.box([0, 2.42, 0.6], [4.2, 0.06, 0.06], fr, { w: [0.3, 0.4] });
    for (const x of [-0.68, 0.68]) b.box([x, 1.27, -0.65], [0.05, 2.3, 0.05], fr, { w: [0.3, 0.4] });
    b.box([2.05, 1.3, 0], [0.14, 1.95, 1.22], C('#2c2f31'), { w: [0.25, 0.3] }); b.quad('ad', [2.124, 1.32, 0], 1.1, 1.72, { ry: PI / 2, w: [0, 0.1] }); b.quad('ad', [1.976, 1.32, 0], 1.1, 1.72, { ry: -PI / 2, ci: 1, w: [0, 0.1] });
    b.box([-0.5, 0.5, -0.4], [2.0, 0.05, 0.36], C('#5a4630'), PLAIN); for (const x of [-1.3, 0.3]) b.box([x, 0.25, -0.4], [0.06, 0.5, 0.3], fr, { w: [0.4, 0.4] });
    b.quad('park', [-2.05, 1.6, -0.2], 0.3, 0.45, { ry: -PI / 2, ci: 6 });
    gl.box([-1.37, 1.27, -0.65], [1.3, 2.2, 0.012], WHITE); gl.box([0, 1.27, -0.65], [1.3, 2.2, 0.012], WHITE); gl.box([1.37, 1.27, -0.65], [1.3, 2.2, 0.012], WHITE); gl.box([-2.05, 1.27, 0], [0.012, 2.2, 1.15], WHITE);
    P.shelter = b.build(); P.shelterGlass = gl.build(); }
  // ---- information kiosk (screens face along the sidewalk)
  { const b = pb(); b.box([0, 1.45, 0], [0.28, 2.9, 0.86], C('#9b9e9f'), { w: [0.08, 0.6] }); b.box([0, 0.06, 0], [0.34, 0.12, 0.92], C('#3d4042'), { w: [0.3, 0.3] }); b.box([0, 0.75, 0], [0.292, 0.7, 0.74], C('#1b1d1f'), PLAIN);
    b.quad('kiosk', [0.146, 1.98, 0], 0.72, 1.62, { ry: PI / 2, w: [0, 0.2] }); b.quad('kiosk', [-0.146, 1.98, 0], 0.72, 1.62, { ry: -PI / 2, ci: 1, w: [0, 0.2] }); b.wrap('sticker', 0.44, 0.9, PI / 2, 0.09, 0.09, { vary: true, ci: 1 }); P.kiosk = b.build(); }
  // ---- pay station, news box
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.02, 0], 0.13, 0.11, C('#5d5a54'), { w: [0, 0], seg: 8, cap: true }); b.box([0, 0.52, 0], [0.1, 1.04, 0.1], C('#2d3238'), { w: [0.35, 0.2] }); b.box([0, 1.32, 0], [0.26, 0.56, 0.3], C('#2d3238'), { w: [0.3, 0.2] }); b.quad('meter', [0.132, 1.32, 0], 0.27, 0.5, { ry: PI / 2 });
    b.box([-0.02, 1.68, 0], [0.34, 0.016, 0.3], C('#12182a'), { w: [0, 0.3], rz: 0.3 }); b.wrap('sticker', 0.071, 0.7, -PI / 2, 0.07, 0.07, { vary: true, ci: 2 }); P.meter = b.build(); }
  { const b = pb(); b.box([0, 0.66, 0], [0.42, 0.9, 0.46], WHITE, { w: [0.4, 0], tint: true }); b.box([0, 1.13, 0], [0.46, 0.05, 0.5], WHITE, { w: [0.5, 0], tint: true }); b.quad('news', [0.212, 0.72, 0], 0.4, 0.66, { ry: PI / 2, vary: true });
    for (const z of [-0.18, 0.18]) b.box([0, 0.1, z], [0.36, 0.2, 0.05], C('#1a1b1c'), { w: [0.6, 0.2] }); b.box([0, 0.012, 0], [0.5, 0.024, 0.5], C('#1a1b1c'), { w: [0.6, 0.2] }); b.wrap('sticker', 0.24, 0.5, -PI / 2, 0.1, 0.1, { ci: 3, cj: 1, x: 0.03 }); P.newsbox = b.build(); }
  // ---- litter basket: slatted steel with a bag liner and what has been thrown in
  const basket = (full) => {
    const b = pb(), g = WHITE, n = 22;
    for (let k = 0; k < n; k++) { const a = k * TAU / n, bent = hsh(k, full ? 3 : 7) < 0.2, rr = 0.281 * (bent ? 0.95 + 0.06 * hsh(k, 4) : 1); b.box([rr * Math.cos(a), 0.47, rr * Math.sin(a)], [0.012, 0.82, 0.04], g, { w: [0.34, 0.25], tint: true, ry: -a + (bent ? (hsh(k, 5) - 0.5) * 0.5 : 0), rz: bent ? (hsh(k, 6) - 0.5) * 0.09 : 0 }); }
    for (const [y, r] of [[0.07, 0.275], [0.48, 0.285], [0.87, 0.3]]) b.cyl([0, y, 0], [0, y + 0.035, 0], r, r + 0.003, g, { w: [0.38, 0.25], seg: 16, tint: true });
    b.cyl([0, 0, 0], [0, 0.06, 0], 0.26, 0.275, C('#141a17'), { w: [0.6, 0.2], seg: 12, cap: true });
    b.cyl([0, 0.08, 0], [0, 0.86, 0], 0.245, 0.27, C('#0a0a0b'), { w: [0, 0.1], seg: 12 });
    // the liner bag folded out over the rim and hanging in loose scallops
    b.push(lumpy(new THREE.TorusGeometry(0.3, 0.035, 5, 18), 0.05, 11, 2), C('#0c0c0d'), { w: [0, 0.15] }, b.mat([0, 0.9, 0], { rx: PI / 2 }));
    for (let k = 0; k < 9; k++) { const a = k * TAU / 9 + 0.2, dr = 0.1 + 0.12 * hsh(k, 21); b.push(lumpy(new THREE.SphereGeometry(1, 5, 4), 0.2, 9, k), C('#0b0b0c'), { w: [0, 0.15] }, b.mat([0.318 * Math.cos(a), 0.9 - dr * 0.5, 0.318 * Math.sin(a)], { ry: -a }, new THREE.Vector3(0.022, dr * 0.6, 0.1))); }
    const stuff = [['#a9a59a', 0.07], ['#7d6444', 0.09], ['#8f8f8a', 0.06], ['#8a4338', 0.05], ['#b5b1a5', 0.08], ['#56697a', 0.05], ['#a39878', 0.07], ['#1a1a1b', 0.06], ['#8c8778', 0.07], ['#5d4a33', 0.08], ['#3d3b38', 0.06]];
    const top = full ? 0.9 : 0.6; b.push(lumpy(new THREE.SphereGeometry(0.24, 9, 5, 0, TAU, 0, PI / 2), 0.2, 13, 3), C('#2a2824'), { w: [0, 0], colFn: (x, y, z) => C(stuff[Math.floor(hsh(Math.round(x * 23), Math.round(z * 23), Math.round(y * 13)) * stuff.length)][0]) }, b.mat([0, top - 0.06, 0], {}, new THREE.Vector3(1, full ? 0.8 : 0.4, 1)));
    const nI = full ? 9 : 3; for (let i = 0; i < nI; i++) { const s = stuff[i], a = i * 2.4, r = 0.05 + 0.13 * hsh(i, 31), y = top + (full ? 0.06 + 0.05 * (i % 3) : -0.02);
      if (i % 3 === 0) b.cyl([r * Math.cos(a), y, r * Math.sin(a)], [r * Math.cos(a) + 0.07 * Math.cos(a * 2), y + 0.07, r * Math.sin(a) + 0.07 * Math.sin(a * 2)], 0.03, 0.038, C(s[0]), { w: [0, 0], seg: 7, cap: true });
      else b.push(lumpy(new THREE.BoxGeometry(s[1] * 2, s[1] * 1.2, s[1] * 1.5, 2, 1, 2), 0.3, 30, i), C(s[0]), PLAIN, b.mat([r * Math.cos(a), y, r * Math.sin(a)], { ry: a, rx: 0.4 * i })); }
    return b.build();
  };
  P.basket = basket(false); P.basketFull = basket(true);
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.88, 0], 0.27, 0.3, WHITE, { w: [0.34, 0.25], seg: 10, tint: true }); b.cyl([0, 0.86, 0], [0, 0.93, 0], 0.325, 0.31, C('#0c0c0d'), { w: [0, 0.1], seg: 10, cap: true }); b.sph([0, 0.9, 0], [0.22, 0.1, 0.22], C('#8a8578'), { w: [0, 0], seg: 6, rings: 3 }); P.basketL = b.build(); }
  // park bin (takes a tint: black, blue, green)
  { const b = pb(); b.cyl([0, 0.03, 0], [0, 0.86, 0], 0.25, 0.265, WHITE, { w: [0.3, 0], seg: 14, tint: true }); b.cyl([0, 0, 0], [0, 0.04, 0], 0.27, 0.26, C('#111213'), { w: [0.4, 0.2], seg: 14, cap: true });
    b.cyl([0, 0.86, 0], [0, 0.915, 0], 0.285, 0.275, C('#17191a'), { w: [0.35, 0.2], seg: 14, cap: true }); const hole = new THREE.CircleGeometry(0.13, 12); hole.rotateX(-PI / 2); b.push(hole, C('#020202'), PLAIN, b.mat([0, 0.918, 0]));
    b.cyl([0, 0.5, 0], [0, 0.68, 0], 0.2625, 0.2655, C('#a9a9a2'), { w: [0.1, 0], seg: 14 }); b.wrap('sticker', 0.27, 0.59, 0.4, 0.12, 0.12, { ci: 3, cj: 2 }); P.pbin = b.build(); }
  // loose litter: a square metre of what blows around a basket
  { const b = pb(); const it = [['#b9b5a8', 0.035], ['#c2bfb4', 0.03], ['#7d6a50', 0.04], ['#8f463c', 0.025], ['#b5b1a5', 0.035], ['#6f7f8a', 0.025], ['#bdb9ad', 0.03], ['#2a2a2b', 0.04], ['#a9a38e', 0.04]];
    it.forEach((s, i) => { const a = hsh(i, 5) * TAU, r = 0.15 + hsh(i, 6) * 0.75; if (i % 3 === 0) b.cyl([r * Math.cos(a), 0.035, r * Math.sin(a)], [r * Math.cos(a) + 0.09, 0.04, r * Math.sin(a) + 0.03], 0.03, 0.024, C(s[0]), { w: [0, 0], seg: 7, cap: true });
      else if (i % 3 === 1) b.quad('white', [r * Math.cos(a), 0.006 + i * 0.001, r * Math.sin(a)], s[1] * 3.4, s[1] * 2.6, { rx: -PI / 2, ry: a, col: C(s[0]), w: [0, 0] });
      else b.push(lumpy(new THREE.IcosahedronGeometry(s[1], 1), 0.35, 60, i), C(s[0]), PLAIN, b.mat([r * Math.cos(a), s[1] * 0.45, r * Math.sin(a)], {}, new THREE.Vector3(1.3, 0.6, 1))); });
    P.scrap = b.build(); }
  // flattened cardboard tied for collection; far stand-in for a pile of bags
  { const b = pb(); for (let k = 0; k < 5; k++) b.box([0.02 * (k % 2), 0.02 + k * 0.035, 0.015 * (k % 3)], [0.95 - 0.06 * (k % 3), 0.03, 0.62 - 0.05 * (k % 2)], C(['#9c7c52', '#a88a5e', '#8c6e48'][k % 3]), { w: [0, 0], ry: 0.06 * (k - 2) });
    b.box([0, 0.1, 0], [0.012, 0.21, 0.66], C('#d9d2bd'), PLAIN); b.box([0.25, 0.1, 0], [0.99, 0.21, 0.012], C('#d9d2bd'), PLAIN); P.cbflat = b.build(); }
  { const b = pb(); b.push(lumpy(new THREE.SphereGeometry(1, 7, 5), 0.14, 5, 2), C('#070708'), { w: [0, 0.05] }, b.mat([0, 0.26, 0], {}, new THREE.Vector3(0.32, 0.3, 0.3))); P.bagLod = b.build(); }
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.55, 0], 0.13, 0.12, C('#16181a'), { w: [0.4, 0.2], seg: 8 }); b.sph([0, 0.6, 0], [0.14, 0.14, 0.14], C('#8f9394'), { w: [0.3, 0.4], seg: 8, rings: 5 }); P.hydLod = b.build(); }
  // ---- bike rack, bike
  { const b = pb(); const path = [[-0.3, 0, 0]]; for (let i = 0; i <= 8; i++) { const a = i * PI / 8; path.push([-0.3 * Math.cos(a), 0.55 + 0.3 * Math.sin(a), 0]); } path.push([0.3, 0, 0]);
    b.tube(path, 0.026, C('#1c1d1f'), { n: 20, seg: 6, w: [0.5, 0.35], tension: 0.2 }); for (const x of [-0.3, 0.3]) b.cyl([x, 0, 0], [x, 0.012, 0], 0.07, 0.07, C('#2a2b2c'), { w: [0.8, 0.3], seg: 8, cap: true }); P.rack = b.build(); }
  const bike = (share, kit) => {
    const b = pb(), fc = WHITE, FR = { w: [0.25, 0.1], tint: true, seg: 6 }, R = 0.335, t = share ? 0.026 : 0.016, mt = C('#9c9fa0');
    for (const x of [-0.5, 0.52]) {
      const tyre = new THREE.TorusGeometry(R, share ? 0.026 : 0.015, 5, 18); b.push(tyre, C('#0c0c0d'), PLAIN, b.mat([x, R + 0.02, 0]));
      b.push(new THREE.TorusGeometry(R - 0.03, 0.009, 3, 16), mt, STEEL, b.mat([x, R + 0.02, 0])); b.cyl([x, R + 0.02, -0.04], [x, R + 0.02, 0.04], 0.022, 0.022, mt, { w: [0.2, 0.6], seg: 6, cap: true });
      for (let k = 0; k < 9; k++) { const a = k * TAU / 9 + x; b.cyl([x, R + 0.02, k % 2 ? 0.025 : -0.025], [x + (R - 0.03) * Math.cos(a), R + 0.02 + (R - 0.03) * Math.sin(a), 0], 0.0035, 0.0035, mt, { w: [0.1, 0.6], seg: 3 }); }
    }
    const Y = R + 0.02, bb = [-0.08, 0.3, 0], st = [-0.2, 0.84, 0], hd = [0.37, 0.86, 0], hb = [0.4, 0.69, 0];
    b.cyl(bb, st, t, t, fc, FR); if (share) b.cyl([-0.05, 0.42, 0], hb, t * 1.5, t * 1.5, fc, FR); else { b.cyl([-0.19, 0.8, 0], hd, t, t, fc, FR); b.cyl(bb, hb, t * 1.15, t * 1.15, fc, FR); }
    b.cyl(hb, [hd[0] - 0.01, hd[1] + 0.03, 0], t * 1.2, t * 1.2, fc, FR);
    for (const z of [-0.05, 0.05]) { b.cyl(bb, [-0.5, Y, z], t * 0.7, t * 0.7, fc, FR); b.cyl([-0.19, 0.78, 0], [-0.5, Y, z], t * 0.6, t * 0.6, fc, FR); b.cyl(hb, [0.52, Y, z], t * 0.8, t * 0.8, share ? fc : C('#1a1b1c'), share ? FR : { w: [0.2, 0.3], seg: 6 }); }
    b.cyl(st, [-0.225, 0.95, 0], 0.012, 0.012, mt, STEEL); b.box([-0.25, 0.97, 0], [0.26, 0.045, share ? 0.17 : 0.13], C('#101011'), PLAIN);
    b.cyl(hd, [0.4, 1.0, 0], 0.012, 0.012, mt, STEEL); b.cyl([0.4, 1.0, -0.27], [0.4, 1.0, 0.27], 0.012, 0.012, share ? C('#161617') : mt, STEEL); for (const z of [-0.24, 0.24]) b.cyl([0.4, 1.0, z - 0.05], [0.4, 1.0, z + 0.05], 0.017, 0.017, C('#0d0d0e'), PLAIN);
    const ch = new THREE.CircleGeometry(0.09, 10); b.push(ch, C('#2a2b2c'), STEEL, b.mat([bb[0], bb[1], 0.045])); b.box([bb[0] + 0.07, bb[1] - 0.12, 0.07], [0.02, 0.17, 0.012], mt, STEEL, ); b.box([bb[0] - 0.07, bb[1] + 0.12, -0.07], [0.02, 0.17, 0.012], mt, STEEL);
    b.box([bb[0] + 0.07, bb[1] - 0.2, 0.11], [0.09, 0.02, 0.07], C('#101011'), PLAIN); b.box([bb[0] - 0.07, bb[1] + 0.2, -0.11], [0.09, 0.02, 0.07], C('#101011'), PLAIN);
    b.box([-0.28, 0.29, 0.045], [0.42, 0.012, 0.006], C('#1d1d1e'), PLAIN); b.box([-0.28, 0.36, 0.045], [0.42, 0.012, 0.006], C('#1d1d1e'), PLAIN);
    if (share) { b.box([0.56, 0.86, 0], [0.2, 0.2, 0.3], fc, { w: [0.2, 0], tint: true }); b.box([-0.5, 0.72, 0], [0.5, 0.02, 0.11], fc, { w: [0.2, 0], tint: true }); b.box([0.662, 0.86, 0], [0.004, 0.14, 0.2], C('#e9e9e2'), PLAIN); }
    if (!share) b.push(new THREE.TorusGeometry(0.11, 0.011, 4, 12), C('#0b0b0c'), PLAIN, b.mat([-0.13, 0.52, 0.03], { rx: 0.5, ry: 0.3 }));        // a lock looped through the frame
    if (kit) { for (const [c, sz] of [[[0.62, 0.9, 0], [0.26, 0.012, 0.32]], [[0.62, 1.0, 0.16], [0.26, 0.2, 0.01]], [[0.62, 1.0, -0.16], [0.26, 0.2, 0.01]], [[0.75, 1.0, 0], [0.01, 0.2, 0.32]], [[0.49, 1.0, 0], [0.01, 0.2, 0.32]]]) b.box(c, sz, C('#1c1d1e'), { w: [0.3, 0.3] });
      b.box([-0.5, 0.72, 0], [0.42, 0.015, 0.12], C('#1c1d1e'), { w: [0.3, 0.3] }); b.cyl([-0.5, 0.72, 0.05], [-0.5, Y, 0.05], 0.006, 0.006, C('#1c1d1e'), PLAIN); b.push(lumpy(new THREE.BoxGeometry(0.34, 0.3, 0.12, 2, 2, 1), 0.06, 9, 4), C('#7a1f1a'), PLAIN, b.mat([-0.5, 0.55, 0.13])); b.push(lumpy(new THREE.BoxGeometry(0.2, 0.16, 0.2, 2, 2, 2), 0.12, 9, 6), C('#22252a'), PLAIN, b.mat([0.62, 0.99, 0])); }
    return b.build();
  };
  // the near bike: round wheels with real spokes, thin tubes, drivetrain, cables, a shaped saddle and a U-lock long enough to take the rack hoop
  const bikeHi = (kit, step) => {
    const b = pb(), fc = WHITE, FR = { w: [0.22, 0.15], tint: true, seg: 8 }, R = 0.335, mt = C('#a4a7a8'), blk = C('#0b0b0c'), dk = C('#4d5052'), Y = R + 0.02, t = 0.0145;
    for (const x of [-0.5, 0.52]) {
      b.push(new THREE.TorusGeometry(R, 0.014, 8, 40), C('#0d0d0e'), { w: [0, 0.22] }, b.mat([x, Y, 0])); b.push(new THREE.TorusGeometry(R - 0.022, 0.008, 5, 36), mt, STEEL, b.mat([x, Y, 0]));
      b.cyl([x, Y, -0.045], [x, Y, 0.045], 0.016, 0.016, mt, { w: [0.2, 0.6], seg: 8, cap: true });
      for (let k = 0; k < 18; k++) { const a = k * TAU / 18 + x, a2 = a + (k % 2 ? 0.35 : -0.35); b.cyl([x + 0.016 * Math.cos(a2), Y + 0.016 * Math.sin(a2), k % 2 ? 0.03 : -0.03], [x + (R - 0.026) * Math.cos(a), Y + (R - 0.026) * Math.sin(a), 0], 0.0016, 0.0016, C('#c9cccc'), { w: [0.05, 0.7], seg: 3 }); }
    }
    const bb = [-0.08, 0.3, 0], st = [-0.2, 0.84, 0], hd = [0.37, 0.86, 0], hb = [0.4, 0.69, 0];
    b.cyl(bb, st, t, t, fc, FR); b.cyl([bb[0], bb[1], -0.04], [bb[0], bb[1], 0.04], 0.022, 0.022, fc, Object.assign({ cap: true }, FR));
    if (step) { b.cyl([-0.15, 0.6, 0], [0.39, 0.72, 0], t, t, fc, FR); b.cyl(bb, hb, t * 1.25, t * 1.25, fc, FR); } else { b.cyl([-0.19, 0.8, 0], hd, t, t, fc, FR); b.cyl(bb, hb, t * 1.2, t * 1.2, fc, FR); }
    b.cyl(hb, [hd[0] - 0.01, hd[1] + 0.03, 0], t * 1.25, t * 1.25, fc, FR);
    for (const z of [-0.05, 0.05]) { b.cyl([bb[0], bb[1], z * 0.6], [-0.5, Y, z], t * 0.6, t * 0.6, fc, FR); b.cyl([-0.19, 0.78, z * 0.3], [-0.5, Y, z], t * 0.55, t * 0.55, fc, FR); b.cyl([hb[0], hb[1], z * 0.5], [0.52, Y, z], t * 0.75, t * 0.75, fc, FR); }
    b.cyl(st, [-0.225, 0.95, 0], 0.011, 0.011, mt, STEEL); b.sph([-0.265, 0.975, 0], [0.11, 0.024, 0.07], blk, { w: [0, 0.15], seg: 10, rings: 6 }); b.sph([-0.15, 0.972, 0], [0.085, 0.02, 0.03], blk, { w: [0, 0.15], seg: 8, rings: 5 });
    b.cyl(hd, [0.4, 1.0, 0], 0.011, 0.011, mt, STEEL); b.cyl([0.4, 1.0, 0], [0.445, 1.0, 0], 0.012, 0.012, mt, STEEL);
    b.tube([[0.43, 1.0, -0.27], [0.445, 1.0, -0.12], [0.445, 1.0, 0.12], [0.43, 1.0, 0.27]], 0.011, mt, { n: 8, seg: 6, w: [0.12, 0.7] });
    for (const z of [-0.24, 0.24]) { b.cyl([0.431, 1.0, z - 0.05], [0.431, 1.0, z + 0.05], 0.016, 0.016, blk, { w: [0, 0], seg: 8, cap: true }); b.cyl([0.445, 0.99, z * 0.75], [0.5, 0.975, z * 0.95], 0.005, 0.005, mt, { w: [0.1, 0.7], seg: 4 }); }
    b.tube([[0.45, 0.99, 0.18], [0.51, 0.9, 0.1], [0.47, 0.76, 0.03], [0.5, 0.68, 0.02]], 0.0035, blk, { n: 8, seg: 4, w: [0, 0] });
    b.tube([[0.45, 0.99, -0.18], [0.51, 0.92, -0.08], [0.36, 0.845, -0.02], [-0.1, 0.8, -0.018], [-0.31, 0.69, -0.03]], 0.0035, blk, { n: 10, seg: 4, w: [0, 0] });
    b.box([0.5, 0.675, 0], [0.03, 0.04, 0.07], mt, STEEL); b.box([-0.335, 0.665, 0], [0.03, 0.04, 0.07], mt, STEEL);
    b.push(new THREE.TorusGeometry(0.085, 0.006, 4, 24), dk, STEEL, b.mat([bb[0], bb[1], 0.045])); for (let k = 0; k < 5; k++) { const a = k * TAU / 5; b.cyl([bb[0], bb[1], 0.045], [bb[0] + 0.085 * Math.cos(a), bb[1] + 0.085 * Math.sin(a), 0.045], 0.005, 0.005, dk, { w: [0.1, 0.7], seg: 3 }); }
    b.push(new THREE.TorusGeometry(0.035, 0.006, 4, 14), dk, STEEL, b.mat([-0.5, Y, 0.045]));
    b.cyl([bb[0], bb[1] + 0.088, 0.045], [-0.5, Y + 0.038, 0.045], 0.004, 0.004, C('#232425'), { w: [0.3, 0.5], seg: 4 }); b.cyl([bb[0], bb[1] - 0.088, 0.045], [-0.5, Y - 0.038, 0.045], 0.004, 0.004, C('#232425'), { w: [0.3, 0.5], seg: 4 });
    b.cyl([bb[0], bb[1], 0.062], [bb[0] + 0.12, bb[1] - 0.125, 0.07], 0.008, 0.007, mt, { w: [0.1, 0.7], seg: 5 }); b.cyl([bb[0], bb[1], -0.062], [bb[0] - 0.12, bb[1] + 0.125, -0.07], 0.008, 0.007, mt, { w: [0.1, 0.7], seg: 5 });
    b.box([bb[0] + 0.12, bb[1] - 0.125, 0.115], [0.09, 0.018, 0.07], blk, PLAIN); b.box([bb[0] - 0.12, bb[1] + 0.125, -0.115], [0.09, 0.018, 0.07], blk, PLAIN);
    b.tube([[-0.17, 0.71, -0.2], [-0.17, 0.71, 0.17], [-0.17, 0.65, 0.215], [-0.17, 0.59, 0.17], [-0.17, 0.59, -0.2]], 0.0075, C('#111213'), { n: 12, seg: 6, w: [0.05, 0.3], tension: 0.3 }); b.cyl([-0.17, 0.565, -0.2], [-0.17, 0.735, -0.2], 0.017, 0.017, C('#1d1e20'), { w: [0.1, 0.2], seg: 8, cap: true });
    if (kit) { for (const [c, sz] of [[[0.64, 0.9, 0], [0.26, 0.012, 0.32]], [[0.64, 1.0, 0.16], [0.26, 0.2, 0.008]], [[0.64, 1.0, -0.16], [0.26, 0.2, 0.008]], [[0.77, 1.0, 0], [0.008, 0.2, 0.32]], [[0.51, 1.0, 0], [0.008, 0.2, 0.32]]]) b.box(c, sz, C('#1c1d1e'), { w: [0.3, 0.3] });
      b.box([-0.5, 0.72, 0], [0.42, 0.012, 0.12], C('#1c1d1e'), { w: [0.3, 0.3] }); for (const z of [-0.05, 0.05]) b.cyl([-0.5, 0.72, z], [-0.5, Y, z], 0.005, 0.005, C('#1c1d1e'), PLAIN);
      b.push(lumpy(new THREE.BoxGeometry(0.34, 0.3, 0.12, 4, 4, 2), 0.05, 9, 4), C('#6a1c18'), PLAIN, b.mat([-0.5, 0.55, 0.13])); b.push(lumpy(new THREE.BoxGeometry(0.2, 0.16, 0.2, 3, 3, 3), 0.1, 9, 6), C('#22252a'), PLAIN, b.mat([0.64, 0.99, 0])); }
    return b.build();
  };
  P.bike = bikeHi(false, false); P.bikeB = bikeHi(true, true); P.bikeM = bike(false); P.bikeShare = bike(true);
  { const b = pb(), FR = { w: [0.25, 0.1], tint: true, seg: 3 }; for (const x of [-0.5, 0.52]) b.push(new THREE.TorusGeometry(0.335, 0.02, 3, 10), C('#0c0c0d'), PLAIN, b.mat([x, 0.355, 0]));
    for (const [p0, p1] of [[[-0.08, 0.3, 0], [-0.2, 0.84, 0]], [[-0.19, 0.8, 0], [0.37, 0.86, 0]], [[-0.08, 0.3, 0], [0.4, 0.69, 0]], [[0.4, 1.0, 0], [0.52, 0.355, 0]], [[-0.2, 0.84, 0], [-0.5, 0.355, 0]], [[-0.08, 0.3, 0], [-0.5, 0.355, 0]]]) b.cyl(p0, p1, 0.02, 0.02, WHITE, FR); b.box([-0.25, 0.97, 0], [0.26, 0.045, 0.13], C('#101011'), PLAIN); b.cyl([0.4, 1.0, -0.27], [0.4, 1.0, 0.27], 0.014, 0.014, C('#55585a'), { w: [0.1, 0.5], seg: 3 }); P.bikeL = b.build(); }
  // bike-share dock (one berth; the bike stands across it), its terminal
  { const b = pb(); b.box([0, 0.035, 0], [0.76, 0.07, 0.62], C('#3a3d3f'), { w: [0.25, 0.3] }); b.box([0, 0.42, -0.2], [0.14, 0.76, 0.2], C('#5d6163'), { w: [0.2, 0.4] }); b.sph([0, 0.8, -0.2], [0.07, 0.05, 0.1], C('#5d6163'), { w: [0.2, 0.4] });
    b.box([0, 0.66, -0.094], [0.1, 0.12, 0.012], C('#16806e'), PLAIN); b.box([0, 0.74, -0.094], [0.03, 0.02, 0.014], C('#7fe0a5'), PLAIN); P.dock = b.build(); }
  { const b = pb(); b.box([0, 1.05, 0], [0.5, 2.1, 0.24], C('#4d5153'), { w: [0.2, 0.4] }); b.quad('dock', [0, 1.25, 0.122], 0.44, 0.88, {}); b.quad('dock', [0, 1.25, -0.122], 0.44, 0.88, { ry: PI }); b.box([0, 2.2, 0], [0.6, 0.02, 0.4], C('#12182a'), { w: [0, 0.3], rx: 0.3 }); b.box([0, 0.03, 0], [0.7, 0.06, 0.5], C('#3a3d3f'), { w: [0.3, 0.3] }); P.dockKiosk = b.build(); }
  // ---- plaza furniture: table, chair, umbrella (tinted), the big concrete planters, granite block, delineator
  { const b = pb(), s = C('#b4b9ba'), M = { w: [0.14, 0.5], seg: 5 }; const top = new THREE.CircleGeometry(0.31, 18); top.rotateX(-PI / 2); b.push(top, s, { cell: 'mesh', w: [0.1, 0.5] }, b.mat([0, 0.722, 0])); b.push(new THREE.TorusGeometry(0.31, 0.012, 3, 14), s, M, b.mat([0, 0.72, 0], { rx: PI / 2 })); b.cyl([0, 0.02, 0], [0, 0.72, 0], 0.02, 0.02, s, M);
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.3; b.cyl([0, 0.2, 0], [0.27 * Math.cos(a), 0.012, 0.27 * Math.sin(a)], 0.012, 0.012, s, { w: [0.14, 0.5], seg: 3 }); } P.ptable = b.build(); }
  { const b = pb(), s = WHITE, M = { w: [0.16, 0.5], seg: 4, tint: true }, M3 = { w: [0.16, 0.5], seg: 3, tint: true };
    for (const z of [-0.18, 0.18]) { b.cyl([0.2, 0, z * 1.1], [0.17, 0.45, z], 0.0075, 0.0075, s, M3); b.cyl([-0.22, 0, z * 1.1], [-0.19, 0.45, z], 0.0075, 0.0075, s, M3); b.cyl([-0.19, 0.45, z], [-0.25, 0.86, z * 0.8], 0.0075, 0.0075, s, M3); b.cyl([0.19, 0.22, z], [-0.2, 0.22, z], 0.007, 0.007, s, M3); }
    b.tube([[-0.25, 0.86, -0.144], [-0.256, 0.9, -0.07], [-0.257, 0.905, 0], [-0.256, 0.9, 0.07], [-0.25, 0.86, 0.144]], 0.01, s, { n: 5, seg: 3, w: [0.16, 0.5], tint: true });
    const seat = new THREE.CircleGeometry(0.2, 10); seat.rotateX(-PI / 2); b.push(seat, s, { cell: 'mesh', w: [0.12, 0.5], tint: true }, b.mat([0, 0.452, 0])); b.push(new THREE.TorusGeometry(0.2, 0.009, 3, 10), s, M, b.mat([0, 0.45, 0], { rx: PI / 2 }));
    b.quad('mesh', [-0.238, 0.72, 0], 0.3, 0.3, { ry: PI / 2, rx: 0, col: s, w: [0.12, 0.5], tint: true }); P.pchair = b.build(); }
  { const b = pb(), T1 = { w: [0.12, 0.4], tint: true }; const seat = new THREE.CircleGeometry(0.2, 8); seat.rotateX(-PI / 2); b.push(seat, C('#d9dcdc'), T1, b.mat([0, 0.452, 0])); b.box([-0.238, 0.72, 0], [0.014, 0.3, 0.3], C('#cfd2d2'), T1); b.box([0, 0.225, 0], [0.2, 0.45, 0.2], C('#4a4d4e'), PLAIN); b.box([-0.22, 0.6, 0], [0.02, 0.3, 0.2], C('#6a6d6e'), PLAIN); P.pchairL = b.build(); }
  { const b = pb(), s = C('#8f9495'); b.cyl([0, 0.7, 0], [0, 0.722, 0], 0.31, 0.31, s, { w: [0.1, 0.5], seg: 8, cap: true }); b.cyl([0, 0, 0], [0, 0.7, 0], 0.05, 0.05, C('#5a5d5e'), { w: [0.1, 0.5], seg: 4 }); P.ptableL = b.build(); }
  const umbrella = (stripe) => {
    const b = pb(); b.cyl([0, 0, 0], [0, 0.07, 0], 0.27, 0.25, C('#2b2c2d'), { w: [0.4, 0.2], seg: 10, cap: true }); b.cyl([0, 0.07, 0], [0, 2.72, 0], 0.022, 0.022, C('#c9cccc'), { w: [0.1, 0.5], seg: 6 });
    const cols = stripe === 1 ? [C('#d8b21c'), C('#1f4f9a')] : stripe === 2 ? [C('#c8322a'), C('#e9e6dc')] : null;
    const cone = new THREE.ConeGeometry(1.2, 0.6, 8, 1, true); b.push(cone, WHITE, cols ? { w: [0, 0], colFn: (x, y, z) => cols[Math.floor((Math.atan2(z, x) + PI) / (TAU / 8) + 0.001) % 2] } : { w: [0, 0], tint: true }, b.mat([0, 2.46, 0]));
    const val = new THREE.CylinderGeometry(1.2, 1.2, 0.11, 8, 1, true); b.push(val, WHITE, cols ? { w: [0, 0], colFn: (x, y, z) => cols[Math.floor((Math.atan2(z, x) + PI) / (TAU / 8) + 0.001) % 2] } : { w: [0, 0], tint: true }, b.mat([0, 2.105, 0]));
    for (let k = 0; k < 8; k++) { const a = k * TAU / 8; b.cyl([0, 2.5, 0], [1.17 * Math.cos(a), 2.17, 1.17 * Math.sin(a)], 0.006, 0.006, C('#c9cccc'), { w: [0.1, 0.5], seg: 3 }); }
    return b.build();
  };
  P.umbrella = umbrella(0); P.umbrellaV1 = umbrella(1); P.umbrellaV2 = umbrella(2);
  { const b = pb(); b.cyl([0, 0, 0], [0, 0.1, 0], 0.34, 0.3, C('#232425'), { w: [0.4, 0.2], seg: 12, cap: true }); b.cyl([0, 0.1, 0], [0, 0.3, 0], 0.045, 0.04, C('#232425'), { w: [0.4, 0.2], seg: 8 }); b.cyl([0, 0.07, 0], [0, 2.62, 0], 0.022, 0.022, C('#c9cccc'), { w: [0.1, 0.5], seg: 6 });
    { const g = new THREE.CylinderGeometry(0.035, 0.2, 1.3, 12, 4, true), Pg = g.attributes.position; for (let i = 0; i < Pg.count; i++) { const x = Pg.getX(i), z = Pg.getZ(i), k = Math.round(Math.atan2(z, x) / (TAU / 12)), f = (k % 2 ? 0.55 : 1) * (0.9 + 0.2 * hsh(k, Math.round(Pg.getY(i) * 5))); Pg.setX(i, x * f); Pg.setZ(i, z * f); } g.computeVertexNormals(); b.push(g, WHITE, { w: [0, 0], tint: true }, b.mat([0, 1.92, 0])); } b.cyl([0, 1.6, 0], [0, 1.64, 0], 0.085, 0.085, C('#d9d6cc'), { w: [0, 0], seg: 8 }); P.umbrellaC = b.build(); }
  const planter = (kind, urn) => {
    let b = pb(); const cc = C(['#a49d8e', '#99948a', '#aaa08c', '#9d9a92'][kind]);
    if (urn) { b.lathe([[0.34, 0], [0.37, 0.05], [0.41, 0.1], [0.5, 0.52], [0.6, 0.67], [0.64, 0.7], [0.64, 0.77], [0.57, 0.77], [0.55, 0.7]], cc, { w: [0.2 + 0.08 * kind, 0], seg: 16 }); b.cyl([0, 0.7, 0], [0, 0.705, 0], 0.56, 0.56, C('#241c14'), { w: [0, 0], seg: 12, cap: true }); } else {
    b.lathe([[0.44, 0], [0.48, 0.05], [0.54, 0.1], [0.7, 0.36], [0.82, 0.48], [0.86, 0.5], [0.86, 0.56], [0.78, 0.56], [0.76, 0.5]], cc, { w: [0.18 + 0.08 * kind, 0], seg: 18 });
    b.cyl([0, 0.5, 0], [0, 0.505, 0], 0.77, 0.77, C('#241c14'), { w: [0, 0], seg: 14, cap: true }); }
    const bowl = b; b = pb();       // the planting is modelled for the old 0.7 m bowl, then spread and lowered into this one
    // a clipped shrub: a dark core under a shell of small leaf triangles, each facing out so the ball has a lit and a shaded side
    const leaf = (x, y, z, r, seed, base, sq = [1, 1, 1]) => {
      b.sph([x, y, z], [r * 0.82 * sq[0], r * 0.82 * sq[1], r * 0.82 * sq[2]], [base[0] * 0.62, base[1] * 0.62, base[2] * 0.6], { w: [0, 0], seg: r < 0.2 ? 6 : 8, rings: r < 0.2 ? 4 : 6 });
      const n = Math.round(70 + 4200 * r * r), pos = [], nor = [];
      for (let i = 0; i < n; i++) {
        const u = hsh(seed, i, 1) * 2 - 1, a = hsh(seed, i, 2) * TAU, sn = Math.sqrt(1 - u * u), rr = r * (0.86 + 0.24 * hsh(seed, i, 3) * hsh(seed, i, 14)) * (1 + 0.2 * Math.sin(a * 3 + seed) * sn + 0.14 * Math.sin(u * 5 + a * 2 + seed * 2)), ox = sn * Math.cos(a), oy = u, oz = sn * Math.sin(a), sz = 0.014 + 0.018 * hsh(seed, i, 4);
        const c = [x + rr * ox * sq[0], y + rr * oy * 0.94 * sq[1], z + rr * oz * sq[2]], v = [], t1 = [-Math.sin(a), 0, Math.cos(a)], t2 = [oy * t1[2] - oz * t1[1], oz * t1[0] - ox * t1[2], ox * t1[1] - oy * t1[0]], a0 = hsh(seed, i, 5) * TAU;
        for (let k = 0; k < 3; k++) { const ak = a0 + k * 2.1 + hsh(seed, i, 6 + k), ca = Math.cos(ak) * sz * (k ? 1 : 1.7), sa = Math.sin(ak) * sz * (k ? 1 : 1.7), nj = (hsh(seed, i, 9 + k) - 0.3) * sz * 0.9; v.push([c[0] + t1[0] * ca + t2[0] * sa + ox * nj, c[1] + t1[1] * ca + t2[1] * sa + oy * nj, c[2] + t1[2] * ca + t2[2] * sa + oz * nj]); }
        const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]], fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0];
        if (fx * ox + fy * oy + fz * oz < 0) { const t = v[1]; v[1] = v[2]; v[2] = t; }
        for (const q of v) { pos.push(q[0], q[1], q[2]); nor.push(ox, oy * 0.8 + 0.2, oz); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 6), 2));
      b.push(g, base, { w: [0, 0], colFn: (px, py, pz) => { const k = (0.78 + 0.44 * hsh(Math.round(px * 60), Math.round(py * 60), Math.round(pz * 60))) * (0.5 + 0.5 * Math.min(1, Math.max(0, (py - y + r) / (1.6 * r)))); return [base[0] * k * 1.25, base[1] * k * 1.2, base[2] * k]; } });
    };
    const tuft = (cx, cz, n, seed, len = 1) => { for (let k = 0; k < n * 2; k++) { const a = hsh(k, seed, 7) * TAU, lean = 0.2 + 0.7 * hsh(k, seed, 8), L = (0.3 + 0.42 * hsh(k, seed, 9)) * len, r0 = 0.14 * hsh(k, seed, 10), col = C(['#5b7a34', '#6f8a3c', '#4c6a2c', '#8a8f45', '#9a955a'][k % 5]);
        const x0 = cx + r0 * Math.cos(a), z0 = cz + r0 * Math.sin(a), dx = Math.cos(a) * lean, dz = Math.sin(a) * lean, g = new THREE.BufferGeometry(), wv = 0.008, px = -Math.sin(a) * wv, pz = Math.cos(a) * wv;
        const p0 = [x0, 0.7, z0], p1 = [x0 + dx * L * 0.5, 0.7 + L * 0.55, z0 + dz * L * 0.5], p2 = [x0 + dx * L * 1.25, 0.7 + L * (0.9 - lean * 0.35), z0 + dz * L * 1.25];
        g.setAttribute('position', new THREE.Float32BufferAttribute([p0[0] - px, p0[1], p0[2] - pz, p0[0] + px, p0[1], p0[2] + pz, p1[0] + px, p1[1], p1[2] + pz, p0[0] - px, p0[1], p0[2] - pz, p1[0] + px, p1[1], p1[2] + pz, p1[0] - px, p1[1], p1[2] - pz, p1[0] - px, p1[1], p1[2] - pz, p1[0] + px, p1[1], p1[2] + pz, p2[0], p2[1], p2[2]], 3));
        g.computeVertexNormals(); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(18), 2)); b.push(g, col, PLAIN); } };
    const blooms = (n, r0, r1, y, seed) => { for (let k = 0; k < n; k++) { const a = hsh(k, seed, 1) * TAU, r = r0 + (r1 - r0) * hsh(k, seed, 2); b.sph([r * Math.cos(a), y + 0.09 * hsh(k, seed, 3), r * Math.sin(a)], [0.034 + 0.022 * hsh(k, seed, 4), 0.024, 0.034 + 0.022 * hsh(k, seed, 5)], C(['#b3202e', '#c9566f', '#d8d4cc', '#b3202e', '#d98aa0', '#c23a4a'][(k + seed) % 6]), { w: [0, 0], seg: 4, rings: 2 }); } };
    if (urn && kind === 0) { leaf(0, 1.13, 0, 0.42, 11, C('#2c4a22'), [1, 0.95, 1]); blooms(70, 0.34, 0.56, 0.75, 1); for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + 0.3; leaf(0.42 * Math.cos(a), 0.78, 0.42 * Math.sin(a), 0.12, 30 + k, C('#3d6a2c'), [1.2, 0.7, 1]); } }
    else if (urn && kind === 2) { tuft(0, 0, 16, 7, 1.5); tuft(0.2, -0.15, 8, 8, 1.1); leaf(-0.18, 0.86, 0.2, 0.24, 15, C('#3a5a2a'), [1.2, 0.7, 1.0]); leaf(0.25, 0.82, 0.18, 0.15, 16, C('#4a6a30'), [1.2, 0.7, 1]); }
    else if (urn) { leaf(0.02, 1.0, 0, 0.4, 12, C('#31502a'), [1.15, 0.8, 1.1]); leaf(-0.3, 0.84, 0.25, 0.17, 13, C('#44652c'), [1.2, 0.7, 1]); leaf(0.32, 0.82, -0.2, 0.15, 14, C('#3d6a2c'), [1.2, 0.7, 1]); blooms(64, 0.3, 0.56, 0.76, 2); }
    else if (kind === 0) { leaf(-0.12, 0.96, 0.05, 0.34, 1, C('#2c4a22'), [1.2, 0.72, 1.0]); leaf(0.3, 0.88, -0.16, 0.22, 2, C('#44652c'), [1.0, 0.8, 1.15]); leaf(0.05, 0.84, 0.36, 0.17, 3, C('#39582a'), [1.3, 0.7, 1.0]); tuft(-0.3, 0.28, 12, 1, 1.0); tuft(0.36, 0.22, 8, 2, 0.8); }
    else if (kind === 1) { leaf(0.05, 0.9, -0.05, 0.3, 4, C('#31502a'), [1.35, 0.6, 1.25]); for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.4 + 0.5 * hsh(k, 3); leaf(0.4 * Math.cos(a), 0.8, 0.4 * Math.sin(a), 0.13 + 0.05 * hsh(k, 4), 20 + k, C('#3d6a2c'), [1.2, 0.7, 1]); } tuft(-0.1, 0.1, 9, 3, 1.25);
      for (let k = 0; k < 30; k++) { const a = hsh(k, 1) * TAU, r = 0.3 + 0.24 * hsh(k, 2); b.sph([r * Math.cos(a), 0.9 + 0.1 * hsh(k, 3), r * Math.sin(a)], [0.02 + 0.014 * hsh(k, 4), 0.014, 0.02 + 0.014 * hsh(k, 5)], C(['#9c2a3e', '#b58f2a', '#b9b5ad', '#7f3a78', '#9c2a3e'][k % 5]), { w: [0, 0], seg: 5, rings: 3 }); } }
    else if (kind === 2) { tuft(0, 0, 22, 4, 1.15); tuft(0.28, -0.2, 10, 5, 0.9); tuft(-0.3, 0.1, 10, 6, 0.8); leaf(0.18, 0.84, 0.22, 0.24, 5, C('#3a5a2a'), [1.25, 0.65, 1.0]); }
    else { leaf(0, 0.94, 0, 0.36, 7, C('#35552a'), [1.3, 0.68, 1.2]); leaf(-0.3, 0.82, 0.28, 0.16, 8, C('#4a6a30'), [1.2, 0.7, 1]); for (let k = 0; k < 46; k++) { const u = 0.15 + 0.85 * hsh(k, 41), a = hsh(k, 42) * TAU, sn = Math.sqrt(1 - u * u); b.sph([0.36 * 1.3 * sn * Math.cos(a), 0.94 + 0.36 * 0.68 * u + 0.01, 0.36 * 1.2 * sn * Math.sin(a)], 0.02 + 0.014 * hsh(k, 43), C(['#c9a0b4', '#d9d5cf', '#c58aa6'][k % 3]), { w: [0, 0], seg: 5, rings: 3 }); } tuft(0.34, -0.26, 8, 9, 0.7); }
    if (!urn) { for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + kind, rr = 0.5 + 0.05 * hsh(k, kind, 51); leaf(rr * Math.cos(a), 0.74 - 0.05 * hsh(k, kind, 52), rr * Math.sin(a), 0.13 + 0.05 * hsh(k, kind, 53), 60 + k + kind * 7, C(['#4a6a30', '#3d6a2c', '#5b7a34'][k % 3]), [1.3, 0.75, 1.1]); } tuft(0.1 * kind - 0.15, -0.3, 8, 20 + kind, 1.1); if (kind % 2) blooms(36, 0.25, 0.56, 0.8, 3 + kind); }
    bowl.merge(b, urn ? new THREE.Matrix4() : new THREE.Matrix4().makeScale(1.32, 1, 1.32).setPosition(0, -0.2, 0)); return bowl.build();
  };
  P.planter0 = planter(0); P.planter1 = planter(1); P.planter2 = planter(2); P.planter3 = planter(3); P.urn0 = planter(0, true); P.urn1 = planter(1, true); P.urn2 = planter(2, true);
  { const b = pb(); b.lathe([[0.34, 0], [0.41, 0.1], [0.5, 0.52], [0.64, 0.7], [0.64, 0.77], [0.55, 0.72]], C('#a49d8e'), { w: [0.24, 0], seg: 9 }); b.push(lumpy(new THREE.SphereGeometry(1, 7, 5), 0.2, 4, 3), C('#2f4c25'), PLAIN, b.mat([0, 1.0, 0], {}, new THREE.Vector3(0.44, 0.4, 0.44))); const fl = [C('#b3202e'), C('#c9566f'), C('#d8d4cc'), C('#3d6a2c')]; b.push(lumpy(new THREE.TorusGeometry(0.46, 0.085, 4, 14), 0.12, 9, 5), fl[0], { w: [0, 0], colFn: (x, y, z) => fl[Math.floor(hsh(Math.round(x * 9), Math.round(z * 9), Math.round(y * 5)) * 4)] }, b.mat([0, 0.78, 0], { rx: PI / 2 })); P.urnL = b.build(); }
  { const b = pb(); b.lathe([[0.44, 0], [0.54, 0.1], [0.7, 0.36], [0.86, 0.5], [0.86, 0.56], [0.76, 0.52]], C('#a49d8e'), { w: [0.22, 0], seg: 10 }); b.push(lumpy(new THREE.SphereGeometry(1, 7, 5), 0.25, 4, 3), C('#2f4c25'), PLAIN, b.mat([0, 0.68, 0], {}, new THREE.Vector3(0.7, 0.32, 0.68))); P.planterL = b.build(); }
  { const b = pb(); b.push(lumpySmooth(new THREE.BoxGeometry(1.25, 0.56, 0.78, 8, 4, 5), 0.014, 3), C('#8f8a80'), { w: [0.14, 0], colFn: (x, y, z) => { const k = (0.72 + 0.5 * hsh(Math.round(x * 31), Math.round(y * 31), Math.round(z * 31))) * (0.85 + 0.15 * Math.min(1, y * 3)); return [0.27 * k, 0.26 * k, 0.24 * k]; } }, b.mat([0, 0.27, 0])); P.block = b.build(); }
  { const b = pb(); b.lathe([[0.13, 0], [0.13, 0.03], [0.06, 0.07], [0.045, 0.09]], C('#101011'), { w: [0, 0], seg: 8 }); b.cyl([0, 0.08, 0], [0, 0.92, 0], 0.04, 0.038, C('#bdbdb4'), { w: [0, 0], seg: 8, cap: true, colFn: (x, y) => (y > 0.62 && y < 0.7) || (y > 0.78 && y < 0.86) ? C('#8e9192') : null }); P.delin = b.build(); }
  // ---- park edge: iron fence panel (2 m), bench stand-in
  { const b = pb(), I = { w: [0.45, 0.25] }; b.box([0, 0.66, 0], [0.055, 1.32, 0.055], cIron, I); b.sph([0, 1.36, 0], 0.05, cIron, Object.assign({ seg: 6, rings: 4 }, I)); b.box([1, 0.16, 0], [2, 0.035, 0.02], cIron, I); b.box([1, 1.08, 0], [2, 0.035, 0.02], cIron, I);
    for (let k = 1; k < 16; k++) { b.box([k * 0.125, 0.64, 0], [0.016, 1.12, 0.016], cIron, I); } b.box([1, -0.05, 0], [2, 0.3, 0.14], C('#6e6a62'), PLAIN); P.fence = b.build(); }
  { const b = pb(), wd = C('#5c452c'); for (const x of [-0.8, 0.8]) { b.box([x, 0.22, 0], [0.05, 0.44, 0.5], cIron, IRON); b.box([x, 0.62, -0.24], [0.05, 0.42, 0.05], cIron, { w: [0.5, 0.25], rx: -0.25 }); b.box([x, 0.6, 0.05], [0.05, 0.03, 0.55], cIron, IRON); }
    for (let k = 0; k < 5; k++) b.box([0, 0.45, -0.18 + k * 0.1], [1.85, 0.03, 0.085], wd, PLAIN); for (let k = 0; k < 3; k++) b.box([0, 0.58 + k * 0.11, -0.25 - k * 0.028], [1.85, 0.09, 0.03], wd, { w: [0, 0], rx: -0.25 }); P.benchP = b.build(); }
  // ---- work sites: cone, A-frame barricade
  { const b = pb(); b.box([0, 0.015, 0], [0.38, 0.03, 0.38], C('#101011'), PLAIN); b.lathe([[0.15, 0.03], [0.14, 0.04], [0.04, 0.7], [0.028, 0.71]], C('#d9521a'), { w: [0, 0], seg: 10, colFn: (x, y) => (y > 0.36 && y < 0.47) || (y > 0.53 && y < 0.6) ? C('#d6d6d0') : null }); P.cone = b.build(); }
  { const b = pb(), lg = C('#c9c9c2'); for (const x of [-0.85, 0.85]) for (const s of [-1, 1]) b.box([x, 0.52, s * 0.17], [0.035, 1.08, 0.05], lg, { w: [0.3, 0.2], rx: s * 0.3 });
    for (const [y, z] of [[0.92, 0.055], [0.55, 0.165]]) { b.quad('stripe', [0, y, z], 1.9, 0.2, { rx: -0.3 }); b.quad('stripe', [0, y, -z], 1.9, 0.2, { rx: 0.3, ry: PI }); } b.quad('closed', [0, 0.74, 0.115], 0.3, 0.3, { rx: -0.3, vary: true }); P.aframe = b.build(); }
  // ---- pipe scaffolding: one bay (2.4 m along X, standing 0.1 .. 1.35 m off the wall on +Z) and one lift (2 m); debris netting
  { const b = pb(), pc = C('#7f8384'), T = { w: [0.3, 0.5], seg: 5 }, wd = C('#8a6f48');
    for (const x of [0, 2.4]) for (const z of [0.12, 1.33]) { b.cyl([x, 0, z], [x, 2.0, z], 0.024, 0.024, pc, T); b.cyl([x, 1.9, z], [x, 2.0, z], 0.032, 0.032, C('#5b3a22'), { w: [0.9, 0.3], seg: 5 }); }
    for (const x of [0, 2.4]) { b.cyl([x, 1.94, 0.12], [x, 1.94, 1.33], 0.022, 0.022, pc, T); b.cyl([x, 0.9, 0.12], [x, 0.9, 1.33], 0.02, 0.02, pc, T); }
    for (const z of [0.12, 1.33]) b.cyl([0, 1.94, z], [2.4, 1.94, z], 0.022, 0.022, pc, T); b.cyl([0, 0.5, 1.33], [2.4, 0.5, 1.33], 0.02, 0.02, pc, T); b.cyl([0, 1.0, 1.33], [2.4, 1.0, 1.33], 0.02, 0.02, pc, T);
    b.cyl([0, 0.06, 1.36], [2.4, 1.9, 1.36], 0.02, 0.02, pc, T); b.cyl([0, 0.1, 0.12], [0, 1.9, 1.33], 0.018, 0.018, pc, T);
    for (let k = 0; k < 4; k++) b.box([1.2, 0.03 + 0.004 * (k % 2), 0.28 + k * 0.3], [2.44, 0.045, 0.27], [wd[0] * (0.8 + 0.1 * k), wd[1] * (0.8 + 0.1 * k), wd[2] * (0.8 + 0.1 * k)], PLAIN);
    b.box([1.2, 0.15, 1.3], [2.4, 0.2, 0.025], wd, PLAIN); P.scaf = b.build(); }
  { const b = pb(); const g = new THREE.PlaneGeometry(2.4, 2.0, 6, 5), Pn = g.attributes.position; for (let i = 0; i < Pn.count; i++) Pn.setZ(i, 0.05 * Math.sin(Pn.getX(i) * 3.1 + Pn.getY(i) * 1.7) + 0.03 * Math.sin(Pn.getY(i) * 5.3 + Pn.getX(i)));
    g.computeVertexNormals(); b.push(g, WHITE, { w: [0, 0], tint: true }, b.mat([1.2, 1.0, 1.4])); P.net = b.build(); }
  // ---- vendor cart
  { const b = pb(), ss = C('#b7bbbc'), S = { w: [0.06, 0.75] };
    b.box([0, 0.76, 0], [1.6, 0.8, 0.86], ss, S); b.box([0, 1.175, 0], [1.66, 0.035, 0.92], ss, S); b.quad('cart', [0, 0.78, 0.432], 1.5, 0.74, { vary: true, w: [0.03, 0.2] }); b.quad('cart', [0, 0.78, -0.432], 1.5, 0.74, { ry: PI, vary: true, w: [0.03, 0.2] });
    for (const z of [-0.47, 0.47]) { b.cyl([-0.3, 0.29, z - 0.05], [-0.3, 0.29, z + 0.05], 0.29, 0.29, C('#0d0d0e'), { w: [0, 0], seg: 12, cap: true }); b.cyl([-0.3, 0.29, z + Math.sign(z) * 0.052], [-0.3, 0.29, z + Math.sign(z) * 0.056], 0.14, 0.14, C('#8f9394'), { w: [0.3, 0.5], seg: 8, cap: true }); }
    b.cyl([0.62, 0.36, 0], [0.62, 0, 0], 0.025, 0.025, C('#2b2c2d'), IRON); b.cyl([0.8, 0.5, 0], [1.25, 0.42, 0], 0.025, 0.025, C('#2b2c2d'), IRON);
    b.box([-0.35, 1.45, 0], [0.8, 0.5, 0.8], ss, S); b.box([-0.35, 1.45, 0.404], [0.7, 0.4, 0.004], C('#1b2226'), { w: [0, 0.4] }); b.box([0.42, 1.22, 0], [0.62, 0.05, 0.7], C('#1a1a1b'), PLAIN);
    b.cyl([0.95, 0.3, -0.25], [0.95, 0.75, -0.25], 0.15, 0.15, C('#c9ccc8'), { w: [0.3, 0.2], seg: 10, cap: true }); b.sph([0.95, 0.75, -0.25], [0.15, 0.08, 0.15], C('#c9ccc8'), { w: [0.3, 0.2] });
    b.box([0.3, 1.33, 0.3], [0.1, 0.2, 0.1], C('#c8322a'), PLAIN); b.box([0.45, 1.33, 0.3], [0.1, 0.2, 0.1], C('#d8b21c'), PLAIN); P.cart = b.build(); }
  // sidewalk shed, one 2.4 x 3 m bay seen from below: plywood, joists, a caged work light on a conduit (self-lit so it reads in the shade)
  { const b = pb(), tim = C('#a88a5c'), LIT = { w: [-0.3, 0] };
    b.quad('ply', [1.2, 2.538, 1.5], 2.4, 3.0, { rx: PI / 2, w: [-0.34, 0] });
    for (const x of [0.3, 0.9, 1.5, 2.1]) b.box([x, 2.47, 1.5], [0.045, 0.13, 2.96], tim, LIT); for (const z of [0.16, 2.84]) b.box([1.2, 2.44, z], [2.4, 0.19, 0.07], C('#8a7048'), LIT);
    b.cyl([0, 2.39, 1.5], [2.4, 2.39, 1.5], 0.012, 0.012, C('#6d7173'), { w: [0.2, 0.5], seg: 4 }); b.cyl([1.2, 2.39, 1.5], [1.2, 2.3, 1.5], 0.03, 0.035, C('#2a2c2d'), { w: [0.2, 0.3], seg: 6 });
    b.sph([1.2, 2.24, 1.5], [0.05, 0.065, 0.05], [1, 0.95, 0.8], { w: [-7, 0], seg: 6, rings: 4 }); for (let k = 0; k < 4; k++) { const a = k * PI / 2; b.cyl([1.2 + 0.035 * Math.cos(a), 2.3, 1.5 + 0.035 * Math.sin(a)], [1.2 + 0.07 * Math.cos(a), 2.16, 1.5 + 0.07 * Math.sin(a)], 0.004, 0.004, C('#c9a227'), { w: [0.1, 0.3], seg: 3 }); }
    b.push(new THREE.TorusGeometry(0.07, 0.004, 3, 8), C('#c9a227'), { w: [0.1, 0.3] }, b.mat([1.2, 2.16, 1.5], { rx: PI / 2 })); P.shedUnder = b.build(); }
  { const b = pb(); b.quad('board', [0, 0.45, 0.012], 1.6, 0.6, { vary: true, w: [0.05, 0] }); b.box([0, 0.45, 0.004], [1.64, 0.64, 0.012], C('#2a2b2c'), PLAIN); P.shedBoard = b.build(); }
  { const b = pb(); b.quad('closed', [0, 0.3, 0.012], 0.44, 0.44, { ci: 1, w: [0.05, 0] }); b.box([0, 0.3, 0.004], [0.47, 0.47, 0.012], C('#d9d6cc'), PLAIN); P.shedPermit = b.build(); }
  return P;
}

// ------------------------------------------------------------------------------------------------ spatial helpers
class Grid {
  constructor(c = 6) { this.c = c; this.m = new Map(); }
  add(x, y, r = 0.5, v = null) { const k = Math.floor(x / this.c) * 100003 + Math.floor(y / this.c); let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push([x, y, r, v]); }
  hit(x, y, r) { const c = this.c, R = r + 3, i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((y - R) / c), j1 = Math.floor((y + R) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = this.m.get(i * 100003 + j); if (a) for (const o of a) { const d = r + o[2]; if ((o[0] - x) * (o[0] - x) + (o[1] - y) * (o[1] - y) < d * d) return o; } } return null; }
}
function pip(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }
const area2 = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
function bbox(r) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of r) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; }
function distRing(x, y, r) { let best = 1e9; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1e-9))); best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return best; }

// ------------------------------------------------------------------------------------------------ the part
export async function add(game, ctx) {
  const city = game.city, world = game.world, shared = world.shared, statics = game.statics, roads = game.roads, AS = ctx.A + 'furniture/';
  const group = new THREE.Group(); group.name = 'st_furniture';
  const SW = 0.15, meta = city.meta, playable = (x, y) => Math.abs(x) < meta.px + 8 && Math.abs(y) < meta.py + 8;

  // ---- street names at the signalled crossings -> blade cells
  const sigs = city.props.signal || [], names = [], nameIx = new Map();
  for (const p of sigs) for (const k of city.nodes[p[4]].e) { const n = city.edges[k].name; if (n && !nameIx.has(n) && names.length < 160) { nameIx.set(n, names.length); names.push(shortName(n)); } }
  if (!names.length) names.push('Broadway');
  const A = makeAtlas(names), P = buildProtos(A), BC = A.cells.blade.cols;
  const fMat = patch(new THREE.MeshStandardMaterial({ map: A.tex, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4 }), shared, 'f'); fMat.shadowSide = THREE.DoubleSide;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2323, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const netMat = patch(new THREE.MeshStandardMaterial({ map: A.tex, vertexColors: true, roughness: 0.95, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), shared, 'f');

  // ---- kinds and placements
  const kinds = {};
  const def = (name, parts, o = {}) => { kinds[name] = Object.assign({ parts: Array.isArray(parts) ? parts : [{ geometry: parts, material: fMat }], far: 400, near: 0, shadow: true, list: [] }, o); };
  // a soft dark patch under things that stand on the ground (the sun shadow map is too coarse for chair legs and bin feet)
  const BLOB = { ptable: 0.55, pchair: 0.4, planter3: 1.05, urn0: 0.85, urn1: 0.85, urn2: 0.85, basket: 0.62, basketFull: 0.62, planter0: 1.05, planter1: 1.05, planter2: 1.05, newsbox: 0.42, hydrant: 0.34, meter: 0.3, pbin: 0.42, can: 0.42, canRust: 0.42, cart: [1.25, 0.8], bike: [0.95, 0.28], bikeB: [0.95, 0.3], bikeShare: [0.95, 0.3],
    pchairL: 0, cbox: 0.4, crate: 0.4, ubox: 0.5, kiosk: [0.4, 0.7], block: [0.9, 0.6], bag: 0.45, chalk: 0.5, barrier: [1.0, 0.45], cone: 0.26, spost: 0.16, busstop: 0.18, bench: [1.1, 0.5], cbflat: [0.6, 0.45] };
  const BINT = [C('#2c3d34'), C('#263830'), C('#5d6163'), C('#6f7375'), C('#232526')];
  const put = (name, x, y, z, h, o) => { const K = kinds[name]; if (!K) return; if ((name === 'basket' || name === 'basketFull') && !(o && o.tint)) o = Object.assign({ tilt: [(hsh(x, y, 71) - 0.5) * 0.09, (hsh(x, y, 72) - 0.5) * 0.09], s: 0.9 + 0.16 * hsh(x, y, 73) }, o, { tint: BINT[Math.floor(hsh(Math.round(x / 60), Math.round(y / 60), 74) * 2.99) + (hsh(x, y, 75) < 0.07 ? 2 : 0)] }); K.list.push([x, y, z, h, o || null]); const B = BLOB[name]; if (name === 'ptable' || name === 'pchair') put(name + 'L', x, y, z, h, o); if (name === 'sigS' || name === 'sigL') put(name === 'sigS' ? 'sigShS' : 'sigShL', x, y, z, h); if (name === 'lampA' || name === 'lampS') put('lampSh', x, y, z, h, { s: name === 'lampA' ? 1 : 0.88 }); if (name === 'bike' || name === 'bikeB') { put('bikeL', x, y, z, h, o); put('bikeM', x, y, z, h, o); } if (name === 'basket' || name === 'basketFull') put('basketL', x, y, z, h, o); if (name === 'planter0' || name === 'planter1' || name === 'planter2' || name === 'planter3') put('planterL', x, y, z, h, o); if (name === 'urn0' || name === 'urn1' || name === 'urn2') put('urnL', x, y, z, h, o);
    if (SHP[name] && kinds['sh_' + SHP[name]]) kinds['sh_' + SHP[name]].list.push([x, y, z, h, o || null]);
    if ((name === 'pchair' || name === 'ptable') && kinds.sunsh && !(o && o.tilt && Math.abs(o.tilt[0]) > 1)) { const hgt = name === 'pchair' ? 0.86 : 0.73, rad = name === 'pchair' ? 0.24 : 0.33, len = hgt * SUN.k; kinds.sunsh.list.push([x + SUN.dx * len / 2, y + SUN.dy * len / 2, z + 0.016, SUN.h, { s: [len / 2 + rad, 1, rad] }]); }
 if (B && kinds.blob) { const k = o && typeof o.s === 'number' ? o.s : 1; kinds.blob.list.push([x, y, z + 0.012, h, { s: typeof B === 'number' ? [B * k, 1, B * k] : [B[0] * k, 1, B[1] * k] }]); } };
  const sdv = world.sunDir || { x: -0.5, y: 0.62, z: 0.6 }, sh2 = Math.hypot(sdv.x, sdv.z) || 1, SUN = { dx: -sdv.x / sh2, dy: sdv.z / sh2, k: Math.min(2.2, sh2 / Math.max(0.2, sdv.y)), h: Math.atan2(sdv.z, -sdv.x) };
  { const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n varying vec2 vSU; varying vec2 vSW;').replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 sP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          sP = instanceMatrix * sP;
        #endif
        sP = modelMatrix * sP; vSW = sP.xz; vSU = uv; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec2 vSU; varying vec2 vSW; uniform sampler2D tLight; uniform vec2 uHalf;').replace('#include <color_fragment>', `#include <color_fragment>
        { vec2 q = vSU * 2.0 - 1.0; float d = length(q); float sun = texture2D(tLight, vec2(vSW.x / (2.0 * uHalf.x) + 0.5, -vSW.y / (2.0 * uHalf.y) + 0.5)).g;
          float holes = mix(1.0, step(0.34, fract(vSU.x * 11.0)) * step(0.34, fract(vSU.y * 5.0)) * 0.6 + 0.4, smoothstep(0.25, 0.4, d) * 0.0 + 0.55);
          diffuseColor.a *= smoothstep(1.0, 0.9, d) * smoothstep(0.35, 0.75, sun) * holes; }`); };
    m.customProgramCacheKey = () => 'stfurnsun1';
    def('sunsh', [{ geometry: geo, material: m, noShadow: true }], { far: 40, shadow: false }); }
  let bkN = 0; const bk = () => (hsh(++bkN, 91) < 0.35 ? 'bikeB' : 'bike');
  { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#9a9a9a'); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c), geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-PI / 2);
    def('blob', [{ geometry: geo, material: new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), noShadow: true }], { far: 45, shadow: false }); }
    def('sigS', P.sigS.geo, { far: 150, fam: 'sticker', shadow: false }); def('sigL', P.sigL.geo, { far: 150, fam: 'sticker', shadow: false });
  const shMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  def('sigShS', [{ geometry: P.sigShS, material: shMat }], { far: 150 }); def('sigShL', [{ geometry: P.sigShL, material: shMat }], { far: 150 }); def('lampSh', [{ geometry: P.lampLod, material: shMat }], { far: 150 });
  const SHP = { planter0: 'planterL', planter1: 'planterL', planter2: 'planterL', planter3: 'planterL', urn0: 'urnL', urn1: 'urnL', urn2: 'urnL', bike: 'bikeL', bikeB: 'bikeL', basket: 'basketL', basketFull: 'basketL' };
  for (const g of ['planterL', 'urnL', 'bikeL', 'basketL']) def('sh_' + g, [{ geometry: P[g], material: shMat }], { far: 60, scale: g === 'basketL' ? 0.9 : undefined }); def('sigLodS', P.sigLodS, { near: 150, far: 650, shadow: false }); def('sigLodL', P.sigLodL, { near: 150, far: 650, shadow: false });
  def('blade', P.blade, { far: 260, shadow: false, fam: 'blade' }); def('armsign', P.armsign, { far: 300, shadow: false, fam: 'blade' }); def('oneway', P.oneway, { far: 260, shadow: false }); def('cab', P.cab, { far: 260, shadow: false });
  def('lampA', P.lampA, { far: 140, fam: 'sticker', shadow: false }); def('lampS', P.lampS, { far: 140, fam: 'sticker', shadow: false }); def('lampLod', P.lampLod, { near: 140, far: 700, shadow: false }); def('banner', P.banner, { far: 220, fam: 'banner', shadow: false });
  def('spost', P.spost, { far: 300 , shadow: false }); def('psign', P.psign, { far: 220, shadow: false, fam: 'park' }); def('psignP', P.psignP, { far: 220, shadow: false, fam: 'park' }); def('psignL', P.psignL, { far: 220, shadow: false, fam: 'park' }); def('busstop', P.busstop, { far: 400 , shadow: false });
  def('shelter', [{ geometry: P.shelter, material: fMat }, { geometry: P.shelterGlass, material: glassMat, noShadow: true }], { far: 500 });
  def('kiosk', P.kiosk, { far: 450, fam: 'sticker' }); def('meter', P.meter, { far: 260, fam: 'sticker' , shadow: false }); def('newsbox', P.newsbox, { far: 260, fam: 'news' });
  def('basket', P.basket, { far: 45, scale: 0.9, shadow: false }); def('basketFull', P.basketFull, { far: 45, scale: 0.9, shadow: false }); def('basketL', P.basketL, { near: 45, far: 220, scale: 0.9, shadow: false }); def('pbin', P.pbin, { far: 260 }); def('scrap', P.scrap, { far: 70, shadow: false }); def('cbflat', P.cbflat, { far: 200 , shadow: false });
  def('bagLod', P.bagLod, { near: 45, far: 300, shadow: false }); def('hydLod', P.hydLod, { near: 110, far: 380, shadow: false });
  def('rack', P.rack, { far: 220 , shadow: false }); def('bike', P.bike, { far: 20, shadow: false }); def('bikeB', P.bikeB, { far: 20, shadow: false }); def('bikeM', P.bikeM, { near: 20, far: 60, shadow: false }); def('bikeL', P.bikeL, { near: 60, far: 170, shadow: false }); def('bikeShare', P.bikeShare, { far: 190 }); def('dock', P.dock, { far: 260 , shadow: false }); def('dockKiosk', P.dockKiosk, { far: 400 , shadow: false });
  def('ptable', P.ptable, { far: 60 }); def('pchair', P.pchair, { far: 36 }); def('ptableL', P.ptableL, { near: 60, far: 260, shadow: false }); def('pchairL', P.pchairL, { near: 36, far: 200, shadow: false }); def('umbrella', P.umbrella, { far: 600 }); def('umbrellaC', P.umbrellaC, { far: 400 , shadow: false }); def('umbrellaV1', P.umbrellaV1, { far: 600 }); def('umbrellaV2', P.umbrellaV2, { far: 600 });
  def('planter0', P.planter0, { far: 50, shadow: false }); def('planter1', P.planter1, { far: 50, shadow: false }); def('planter2', P.planter2, { far: 50, shadow: false }); def('planter3', P.planter3, { far: 50, shadow: false }); def('urn0', P.urn0, { far: 30, shadow: false }); def('urn1', P.urn1, { far: 30, shadow: false }); def('urn2', P.urn2, { far: 30, shadow: false }); def('urnL', P.urnL, { near: 30, far: 300, shadow: false }); def('planterL', P.planterL, { near: 50, far: 300, shadow: false }); def('block', P.block, { far: 400 }); def('delin', P.delin, { far: 220, shadow: false });
  def('fence', P.fence, { far: 240 , shadow: false }); def('benchP', P.benchP, { near: 0, far: 320 , shadow: false }); def('cone', P.cone, { far: 220 , shadow: false }); def('aframe', P.aframe, { far: 260, fam: 'closed' , shadow: false });
  def('scaf', P.scaf, { far: 120, shadow: false }); def('net', [{ geometry: P.net, material: netMat, noShadow: true }], { far: 200, shadow: false }); def('cart', P.cart, { far: 450, fam: 'cart' });
  def('shedUnder', P.shedUnder, { far: 80, shadow: false }); def('shedBoard', P.shedBoard, { far: 200, shadow: false, fam: 'board' }); def('shedPermit', P.shedPermit, { far: 90, shadow: false });

  // ---- scanned props (Poly Haven CC0, simplified): each is optional, a missing file only drops its kind
  const loader = new GLTFLoader();
  const scans = {};
  await Promise.all(['fire_hydrant', 'metal_trash_can', 'trashbag', 'cardboard_box_01', 'concrete_road_barrier', 'plastic_crate_02', 'standing_chalkboard_01', 'outdoor_table_chair_set_01', 'utility_box_01', 'modular_street_seating']
    .map((n) => loader.loadAsync(AS + n + '.glb').then((g) => { scans[n] = g; }).catch((e) => console.log('[streets] furniture: scan ' + n + ' not loaded: ' + (e && e.message)))));
  const scanMats = new Map();
  const scanMat = (m, extra) => { const k = m.uuid + (extra || ''); if (!scanMats.has(k)) { const c = m.clone(); if (m.transparent) c.alphaTest = 0.5; c.transparent = false; c.depthWrite = true; if (c.map) c.map.anisotropy = 4; patch(c, shared, 's', extra || ''); scanMats.set(k, c); } return scanMats.get(k); };
  // pick the meshes of a scan whose node name matches, bake their node transforms, stand the set on its own footprint centre
  const scanKind = (name, file, re, o = {}) => {
    const g = scans[file]; if (!g) return false; g.scene.updateMatrixWorld(true); const parts = []; const box = new THREE.Box3();
    g.scene.traverse((m) => { if (!m.isMesh) return; const nm = m.name + '|' + (m.parent ? m.parent.name : ''); if (!re.test(nm) || (o.not && o.not.test(nm))) return; const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); geo.computeBoundingBox(); box.union(geo.boundingBox); parts.push({ geometry: geo, material: scanMat(m.material, o.extra) }); });
    if (!parts.length) return false;
    const cx = o.center === false ? 0 : (box.min.x + box.max.x) / 2, cz = o.center === false ? 0 : (box.min.z + box.max.z) / 2;
    const byMat = new Map(); for (const p of parts) { for (const a of Object.keys(p.geometry.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'uv') p.geometry.deleteAttribute(a); if (!byMat.has(p.material)) byMat.set(p.material, []); byMat.get(p.material).push(p.geometry); }
    const merged = []; for (const [material, gs] of byMat) { let geometry = gs.length > 1 ? mergeGeometries(gs, false) : gs[0]; if (!geometry) geometry = gs[0]; merged.push({ geometry, material }); }
    for (const p of merged) { p.geometry.translate(-cx, -box.min.y, -cz); if (o.pre) p.geometry.applyMatrix4(o.pre); p.geometry.computeBoundingSphere(); p.geometry.computeBoundingBox(); }
    def(name, merged, o); return true;
  };
  const NYC_HYDRANT = /* glsl */`{ float g0 = dot(diffuseColor.rgb, vec3(0.4, 0.4, 0.2)); float top = smoothstep(0.52, 0.56, vFw.z); diffuseColor.rgb = mix(vec3(g0) * vec3(0.2, 0.21, 0.22) + 0.004, vec3(g0) * vec3(1.5, 1.52, 1.5) + 0.04, top); }`;
  scanKind('hydrant', 'fire_hydrant', /_aged/, { not: /chain/, far: 110, extra: NYC_HYDRANT, pre: new THREE.Matrix4().makeScale(1.3, 0.94, 1.3) });
  scanKind('can', 'metal_trash_can', /^metal_trash_can(\||_handle)/, { not: /rust|lid/, far: 130 });
  scanKind('canRust', 'metal_trash_can', /rust/, { not: /lid/, far: 130 });
  scanKind('bag', 'trashbag', /trashbag/, { far: 45 });
  scanKind('cbox', 'cardboard_box_01', /cardboard/, { far: 80, shadow: false });
  scanKind('barrier', 'concrete_road_barrier', /barrier/, { far: 320 });
  scanKind('crate', 'plastic_crate_02', /crate/, { far: 70, shadow: false });
  scanKind('chalk', 'standing_chalkboard_01', /chalkboard/, { far: 120 });
  scanKind('cafe', 'outdoor_table_chair_set_01', /table_chair/, { far: 150, center: false });
  scanKind('ubox', 'utility_box_01', /utility/, { far: 300 });
  if (scanKind('bench', 'modular_street_seating', /^(legs_double|legs_single|back_support_r|back_support_l|arm_rest_01|arm_rest_02|seat|seat_back)\|/, { far: 75 })) kinds.benchP.near = 75;
  if (!kinds.hydrant) { kinds.hydLod.near = 0; } if (!kinds.bag) kinds.bagLod.near = 0;

  // ---- what is already standing: the lead's trees, the dressing layer's kerb pieces
  const occ = new Grid(6);
  for (const p of city.props.tree || []) occ.add(p[0], p[1], 1.3);
  let DR = null;
  if (game.dressing && game.dressing.meshes && game.dressing.meshes.length) {
    try { const [J, buf] = await Promise.all([fetch('assets/dressing/dressing.json').then((r) => r.json()), fetch('assets/dressing/dressing.bin').then((r) => r.arrayBuffer())]); DR = { J, F: new Float32Array(buf), S: J.stride }; }
    catch (e) { console.log('[streets] furniture: dressing data not read: ' + (e && e.message)); }
  }
  const dEach = (kind, fn) => { if (!DR || !DR.J.kinds[kind]) return; const K = DR.J.kinds[kind], F = DR.F, S = DR.S; for (let i = 0; i < K.n; i++) { const o = (K.off + i) * S; fn(F[o], F[o + 1], F[o + 2], F[o + 3], F[o + 4], F[o + 5], F[o + 6]); } };
  const shedGrid = new Grid(8);
  for (const [k, r] of [['rack', 0.7], ['planter', 0.9], ['bollard', 0.3], ['mailbox', 0.6], ['barrel', 0.45], ['shed_post', 0.2], ['cellar', 1.0], ['post', 0.25]]) dEach(k, (x, y) => occ.add(x, y, r));
  dEach('shed_post', (x, y) => shedGrid.add(x, y, 0.2));
  // buildings: a grid for "which building is here"
  const bgrid = new Map(), BLC = 40;
  city.buildings.forEach((b, bi) => { if (b.minh >= 2.5) return; const bb = b.bb || (b.bb = bbox(b.poly)); for (let i = Math.floor(bb[0] / BLC); i <= Math.floor(bb[2] / BLC); i++) for (let j = Math.floor(bb[1] / BLC); j <= Math.floor(bb[3] / BLC); j++) { const k = i * 100003 + j; let a = bgrid.get(k); if (!a) bgrid.set(k, (a = [])); a.push(b); } });
  const bldAt = (x, y) => { const a = bgrid.get(Math.floor(x / BLC) * 100003 + Math.floor(y / BLC)); if (a) for (const b of a) { const bb = b.bb; if (x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3] && pip(x, y, b.poly)) return b; } return null; };
  const parks = (city.parks || []).map((p) => ({ ext: p.ext, bb: bbox(p.ext) }));
  const inPark = (x, y) => { for (const p of parks) if (x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && pip(x, y, p.ext)) return true; return false; };
  // edges: nearest one to a point; crossings: distance to the nearest one
  const egrid = new Map(), EC = 60;
  city.edges.forEach((e) => { const bb = bbox(e.pts); for (let i = Math.floor((bb[0] - 30) / EC); i <= Math.floor((bb[2] + 30) / EC); i++) for (let j = Math.floor((bb[1] - 30) / EC); j <= Math.floor((bb[3] + 30) / EC); j++) { const k = i * 100003 + j; let a = egrid.get(k); if (!a) egrid.set(k, (a = [])); a.push(e); } });
  const nearEdge = (x, y, maxD = 28) => { const a = egrid.get(Math.floor(x / EC) * 100003 + Math.floor(y / EC)); let best = null; if (a) for (const e of a) { if (!e.line) continue; const pr = e.line.project(x, y); if (pr.d < maxD && (!best || pr.d < best.d)) best = { e, d: pr.d }; } return best; };
  const ngrid = new Grid(40); city.nodes.forEach((n) => { if (n.e.length >= 3) ngrid.add(n.p[0], n.p[1], n.r || 6, n); });
  const cornerDist = (x, y) => { let best = 1e9; const c = 40; for (let i = Math.floor((x - 30) / c); i <= Math.floor((x + 30) / c); i++) for (let j = Math.floor((y - 30) / c); j <= Math.floor((y + 30) / c); j++) { const a = ngrid.m.get(i * 100003 + j); if (a) for (const o of a) best = Math.min(best, Math.hypot(o[0] - x, o[1] - y) - o[2]); } return best; };
  const wallDist = (x, y, nx, ny) => { const t = statics.raycast(x + nx * 0.3, y + ny * 0.3, x + nx * 14, y + ny * 14); return t >= 1 ? null : 0.3 + t * 13.7; };
  // grating panels: ctx.parts.ground.grates = [[x, y, dx, dy, halfAlong, halfAcross], ...] (map metres, unit direction along the run)
  const gratesIn = (ctx.parts && ctx.parts.ground && ctx.parts.ground.grates) || [], grateGrid = new Grid(6);
  for (const g of gratesIn) grateGrid.add(g[0], g[1], Math.hypot(g[4] || 0.75, g[5] || 0.56), g);
  const onGrate = (x, y, r) => { const o = grateGrid.hit(x, y, r); if (!o) return false; const g = o[3], u = (x - g[0]) * g[2] + (y - g[1]) * g[3], v = -(x - g[0]) * g[3] + (y - g[1]) * g[2]; return Math.abs(u) < (g[4] || 0.75) + r && Math.abs(v) < (g[5] || 0.56) + r; };
  const offGrate = (x, y, r) => { const o = grateGrid.hit(x, y, r); if (!o || !onGrate(x, y, r)) return [x, y]; const g = o[3], v = -(x - g[0]) * g[3] + (y - g[1]) * g[2], d = ((g[5] || 0.56) + r + 0.6) * (v >= 0 ? 1 : -1) - v; return [x - g[3] * d, y + g[2] * d]; };
  const free = (x, y, r) => playable(x, y) && !occ.hit(x, y, r) && statics.onSidewalk(x, y) && !roads.inLane(x, y, r + 0.25) && !bldAt(x, y) && !onGrate(x, y, Math.min(0.35, r * 0.5));
  let SOLID = true;                       // switched off where only the planters and blocks may stop a car (shared streets)
  const take = (x, y, r, solid) => { occ.add(x, y, r); if (solid && SOLID) statics.addCircle(x, y, solid, 'furniture'); };
  const circles = { n: 0 }; const solid = (x, y, r) => { if (!SOLID) return; statics.addCircle(x, y, r, 'furniture'); circles.n++; };
  const TINTS = { news: [C('#b3261e'), C('#1f4f9a'), C('#d8b21c'), C('#2c6b3f'), C('#d9d8d0'), C('#e06a1c')], bike: [C('#141516'), C('#141516'), C('#2a2c2f'), C('#5d6063'), C('#8a8d8f'), C('#3a1614'), C('#14263a'), C('#1f3324'), C('#7a6a3a'), C('#a8aaa6')],
    umb: [C('#5f7426'), C('#8f2a22'), C('#b9b09a'), C('#23485a'), C('#c9c6bc')], net: [C('#0b0b0c'), C('#0b0b0c'), C('#123a22'), C('#c9521a'), C('#1c3a6a')], pbin: [C('#151617'), C('#1c3f6e'), C('#1f4a30')] };
  const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r * a.length))];
  const scrapAt = (x, y, seed) => put('scrap', x, y, SW, hsh(seed, 1) * TAU, { s: 0.8 + hsh(seed, 2) * 0.7 });

  // ================================================================= signals
  const L = game.sigLamps, lampFix = [];
  const pedSlots = [];                        // [matrix, slot 0 = A (walks on green), 1 = B (walks on red)] per signal
  sigs.forEach((p, i) => {
    const th = p[2] + (p[6] || 0), y0 = p[7] || SW, node = city.nodes[p[4]]; let width = p[5] ? 17.8 : 9.6, apName = null; const streets = new Map();
    for (const k of node.e) { const e = city.edges[k]; if (e.b === p[4] || e.a === p[4]) { const pts = e.b === p[4] ? e.pts : e.pts.slice().reverse(), a = pts[pts.length - 2], b = pts[pts.length - 1]; if (Math.abs(angDiff(Math.atan2(b[1] - a[1], b[0] - a[0]), p[2])) < 0.35) { width = e.width; apName = e.name; } }
      if (e.name && !streets.has(e.name)) { const q = e.pts, near0 = Math.hypot(q[0][0] - node.p[0], q[0][1] - node.p[1]) < Math.hypot(q[q.length - 1][0] - node.p[0], q[q.length - 1][1] - node.p[1]), a = near0 ? q[0] : q[q.length - 2], b = near0 ? q[1] : q[q.length - 1]; streets.set(e.name, [Math.atan2(b[1] - a[1], b[0] - a[0]), e.oneway]); } }
    const long = width >= 14, K = long ? P.sigL : P.sigS, r = hsh(p[0], p[1], 1);
    put(long ? 'sigL' : 'sigS', p[0], p[1], y0, th, { cell: [Math.floor(r * 5), Math.floor(hsh(p[0], p[1], 2) * 3)] }); put(long ? 'sigLodL' : 'sigLodS', p[0], p[1], y0, th);
    let bi = 0, oi = 0;
    for (const [name, [ang, ow]] of [...streets.entries()].sort().slice(0, 2)) { const ci = nameIx.get(name); if (ci !== undefined) put('blade', p[0], p[1], y0 + 3.62 + 0.3 * bi++, ang + (hsh(p[0], bi, 5) < 0.5 ? PI : 0), { cell: [ci % BC, Math.floor(ci / BC)] }); if (ow) put('oneway', p[0], p[1], y0 + 3.2 - 0.36 * oi++, ang); }
    if (long) { const cross = [...streets.keys()].sort().find((nm) => nm !== apName), ci = cross ? nameIx.get(cross) : undefined; if (ci !== undefined) put('armsign', p[0], p[1], y0, th, { cell: [ci % BC, Math.floor(ci / BC)] }); }
    if (hsh(p[0], p[1], 3) < 0.38) put('cab', p[0], p[1], y0, th);
    if (hsh(p[0], p[1], 4) < 0.5) put('psignP', p[0], p[1], y0 + 1.9, th + 0.25, { cell: [Math.floor(hsh(p[0], p[1], 5) * 8), 0], tilt: [0, (hsh(p[0], p[1], 6) - 0.5) * 0.06] });
    occ.add(p[0], p[1], 0.9);
    // lit lamps: the lead's three discs per signal, moved onto our lenses
    const M = new THREE.Matrix4().compose(new THREE.Vector3(p[0], y0, -p[1]), new THREE.Quaternion().setFromAxisAngle(UP, th), new THREE.Vector3().setScalar(p[3] || 1));
    if (L && L.base) K.heads.forEach((h, j) => { for (const [k, dy] of [['r', 0.345], ['y', 0], ['g', -0.345]]) { const T = new THREE.Matrix4().makeRotationY(h.yaw).setPosition(h.x, h.y, h.z).multiply(new THREE.Matrix4().makeTranslation(0.012, dy * h.s, 0)).multiply(new THREE.Matrix4().makeScale(h.s * 1.15, h.s * 1.15, h.s * 1.15)); L.base[k][i * 3 + j] = new THREE.Matrix4().multiplyMatrices(M, T); } });
    pedSlots.push(K.peds.map((q) => new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeRotationY(q.ry + PI / 2).setPosition(q.x + (q.ry ? 0 : 0.008), q.y, q.z + (q.ry ? 0.008 : 0)))));
    // corner company: a litter basket past the pole, a cabinet, news boxes, a vendor on the avenues
    const dx = Math.cos(p[2]), dy = Math.sin(p[2]);
    const along = (k, side = 0) => [p[0] + dx * k + dy * side, p[1] + dy * k - dx * side];      // side > 0: away from the roadway being crossed? (right of travel)
    { const [x, y] = along(2.3, 0.1), rb = hsh(p[0], p[1], 6); if (rb < 0.8 && free(x, y, 0.5)) { put(rb < 0.08 ? 'basketFull' : 'basket', x, y, SW, rb * 40, { tilt: [0.03 * (rb - 0.4), 0.02] }); take(x, y, 0.5, 0.3); if (rb < 0.45) scrapAt(x + 0.3, y - 0.2, p[0] + p[1]); } }
    { const [x, y] = along(4.0, 0.15), ru = hsh(p[0], p[1], 7); if (ru < 0.22 && kinds.ubox && free(x, y, 0.6)) { put('ubox', x, y, SW, p[2] + PI / 2); take(x, y, 0.6, 0.4); } }
    { const rn = hsh(p[0], p[1], 8); if (rn < 0.3) { const n = 2 + Math.floor(rn * 12) % 3; for (let q = 0; q < n; q++) { const [x, y] = along(5.6 + q * 0.56, 0.05); if (!free(x, y, 0.3)) break; put('newsbox', x, y, SW, p[2] - PI / 2 + (hsh(p[0], q, 9) - 0.5) * 0.12, { tint: pick(TINTS.news, hsh(p[0], q, 10)), cell: [Math.floor(hsh(p[0], q, 11) * 6), 0] }); take(x, y, 0.3, 0.28); } }
      if (p[5] || hsh(p[0], p[1], 15) < 0.45) { const cartC = p[5] && hsh(p[0], p[1], 12) < 0.3, s0 = rn < 0.3 ? 8.0 : 5.0, nU = cartC ? (rn < 0.3 ? 0 : 2) : 2 + Math.floor(hsh(p[0], p[1], 16) * 2.99), uk = 'urn' + Math.floor(hsh(p[0], p[1], 13) * 2);
        for (let q = 0; q < nU; q++) { const [x, y] = along(s0 + q * 1.9, 0.2); if (free(x, y, 0.72)) { put(hsh(p[0], q, 17) < 0.6 ? uk : 'urn' + Math.floor(hsh(p[1], q, 18) * 2.3), x, y, SW, rn * 30 + q * 2.1, { s: 0.82 + 0.4 * hsh(p[0], q, 14), tilt: [(hsh(p[0], q, 19) - 0.5) * 0.03, 0] }); take(x, y, 0.75, 0.62); } } } }
    { const rv = hsh(p[0], p[1], 12); if (p[5] && rv < 0.3) { const [x, y] = along(9.5, 0.2); if (free(x, y, 1.5) && free(x + dx * 1.2, y + dy * 1.2, 0.8)) { put('cart', x, y, SW, p[2] + (rv < 0.15 ? PI : 0), { cell: [Math.floor(rv * 10) % 3, 0] }); put(rv < 0.16 ? 'umbrellaV1' : 'umbrellaV2', x + dx * 0.25, y + dy * 0.25, SW + 0.25, rv * 20, { s: 0.92 }); take(x, y, 1.5, 0); solid(x - dx * 0.4, y - dy * 0.4, 0.5); solid(x + dx * 0.4, y + dy * 0.4, 0.5);
        if (kinds.crate) put('crate', x - dx * 1.25 + dy * 0.2, y - dy * 1.25 - dx * 0.2, SW, rv * 9); if (kinds.cbox) put('cbox', x - dx * 1.3 - dy * 0.25, y - dy * 1.3 + dx * 0.25, SW, rv * 5); } } }
  });
  if (L && L.state) L.state.fill('');
  if (L && L.g && L.g.material) { L.g.material.color.setRGB(0.0, 1.15, 0.3); L.r.material.color.setRGB(2.3, 0.08, 0.04); L.y.material.color.setRGB(2.3, 1.2, 0.07); }        // the lead's lamp colours bloom to white
  // lit pedestrian faces: an orange hand or a white walker, switched with the vehicle phases
  const pedLit = { hand: null, walk: null, state: new Array(sigs.length).fill('') };
  if (sigs.length) {
    const mk = (ci) => { const b = new PB(A); b.quad('ped', [0, 0, 0], 0.37, 0.37, { ci }); const g = b.build(); const m = new THREE.MeshBasicMaterial({ map: A.tex, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false }); const im = new THREE.InstancedMesh(g, m, sigs.length * 2); im.frustumCulled = false; im.matrixAutoUpdate = false; group.add(im); return im; };
    pedLit.hand = mk(0); pedLit.walk = mk(1); const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const upd = () => { let dirty = false; sigs.forEach((p, i) => { const st = L && L.state ? L.state[i] : 'r'; if (st === pedLit.state[i]) return; pedLit.state[i] = st; dirty = true; for (let j = 0; j < 2; j++) { const walk = j === 0 ? st === 'g' : st === 'r'; pedLit.walk.setMatrixAt(i * 2 + j, walk ? pedSlots[i][j] : hide); pedLit.hand.setMatrixAt(i * 2 + j, walk ? hide : pedSlots[i][j]); } }); if (dirty) { pedLit.hand.instanceMatrix.needsUpdate = true; pedLit.walk.instanceMatrix.needsUpdate = true; } };
    const prevUpd = game.updateSignals; game.updateSignals = function () { prevUpd.call(this); upd(); };
    try { game.updateSignals(); } catch (e) { console.log('[streets] furniture: signal refresh: ' + e.message); }
    if (pedLit.state[0] === '') { pedLit.state.fill('x'); sigs.forEach((p, i) => { for (let j = 0; j < 2; j++) { pedLit.hand.setMatrixAt(i * 2 + j, pedSlots[i][j]); pedLit.walk.setMatrixAt(i * 2 + j, hide); } }); }
  }

  // ================================================================= street lights
  for (const p of city.props.light || []) {
    const th = p[2] - PI / 2, e = nearEdge(p[0] + Math.cos(th) * 3, p[1] + Math.sin(th) * 3), ave = !!(e && e.e.ave), r = hsh(p[0], p[1], 20);
    put(ave ? 'lampA' : 'lampS', p[0], p[1], SW, th, { cell: [Math.floor(r * 5), Math.floor(hsh(p[0], p[1], 21) * 3)], tilt: [(r - 0.5) * 0.012, (hsh(p[0], p[1], 22) - 0.5) * 0.012] }); put('lampLod', p[0], p[1], SW, th, { s: ave ? 1 : 0.88 });
    if (ave && r < 0.62) put('banner', p[0], p[1], SW, th, { cell: [Math.floor(hsh(Math.round(p[0] / 90), Math.round(p[1] / 90), 23) * 4), 0] });
    if (hsh(p[0], p[1], 24) < 0.55) put('psignL', p[0], p[1], SW + 2.3, th + (hsh(p[0], p[1], 25) < 0.5 ? PI / 2 : -PI / 2), { cell: [Math.floor(hsh(p[0], p[1], 26) * 8), 0], tilt: [(hsh(p[0], p[1], 27) - 0.5) * 0.05, 0] });
    occ.add(p[0], p[1], 0.7);
  }

  // ================================================================= the lead's hydrants, bins, news boxes, meters
  for (const p of city.props.hydrant || []) { put('hydrant', p[0], p[1], SW, hsh(p[0], p[1], 30) * TAU, { s: 0.95 + 0.1 * hsh(p[0], p[1], 31), tilt: [(hsh(p[0], p[1], 32) - 0.5) * 0.06, (hsh(p[0], p[1], 33) - 0.5) * 0.06] }); put('hydLod', p[0], p[1], SW, 0); occ.add(p[0], p[1], 0.7); }
  for (const p of city.props.bin || []) { const r = hsh(p[0], p[1], 34); if (!free(p[0], p[1], 0.4)) continue; put(r < 0.1 ? 'basketFull' : 'basket', p[0], p[1], SW, r * 30, { tilt: [0.03 * (r - 0.5), 0.015] }); take(p[0], p[1], 0.5, 0.3); if (r < 0.5) scrapAt(p[0] + 0.25, p[1] + 0.2, p[0]); }
  for (const p of city.props.newsbox || []) { const n = 1 + Math.floor(hsh(p[0], p[1], 35) * 3), dx = Math.cos(p[2]), dy = Math.sin(p[2]); for (let q = 0; q < n; q++) { const x = p[0] + dx * q * 0.56, y = p[1] + dy * q * 0.56; if (!free(x, y, 0.3)) break; put('newsbox', x, y, SW, p[2] + PI / 2 + (hsh(x, y, 36) - 0.5) * 0.14, { tint: pick(TINTS.news, hsh(x, y, 37)), cell: [Math.floor(hsh(x, y, 38) * 6), 0] }); take(x, y, 0.32, 0.28); } }
  for (const p of city.props.meter || []) { if (!free(p[0], p[1], 0.3)) continue; put('meter', p[0], p[1], SW, p[2] + PI / 2, { cell: [Math.floor(hsh(p[0], p[1], 39) * 5), 1] }); take(p[0], p[1], 0.4, 0.16); }

  // ================================================================= the dressing layer's parking signs and bags, redone
  const hideKinds = new Set(['blade', 'oneway', 'psign', 'bags']), postKill = new Grid(6);
  { const seen = new Grid(4);
    dEach('psign', (x, y, z, h) => { postKill.add(x, y, 0.2); if (seen.hit(x, y, 0.1)) return; seen.add(x, y, 0.1); const r = hsh(x, y, 40), n = 1 + (r < 0.55 ? 1 : 0) + (r < 0.15 ? 1 : 0);
      const pq = new THREE.Quaternion().setFromEuler(new THREE.Euler((hsh(x, y, 41) - 0.5) * 0.11, h + PI / 2, (hsh(x, y, 42) - 0.5) * 0.11, 'YXZ')), up = new THREE.Vector3(0, 1, 0).applyQuaternion(pq), flip = hsh(x, y, 43) < 0.5 ? PI / 2 : -PI / 2;
      put('spost', x, y, SW, 0, { q: pq, s: [1, 0.86 + 0.08 * n, 1] });
      for (let q = 0; q < n; q++) { const hh = 2.3 + 0.08 * n - q * 0.5, lq = pq.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((hsh(x, y, 63 + q) - 0.5) * 0.05, flip + (hsh(x, y, 60 + q) - 0.5) * 0.14, (hsh(x, y, 47 + q) - 0.5) * 0.05, 'YXZ'))); put('psign', x + up.x * hh, y - up.z * hh, SW + up.y * hh, 0, { q: lq, cell: [Math.floor(hsh(x, y, 44 + q) * 8), 0] }); }
      occ.add(x, y, 0.3); solid(x, y, 0.05); }); }
  const bagPile = (x, y, tx, ty, seed, big) => {
    const n = (big ? 4 : 2) + Math.floor(hsh(seed, 1) * (big ? 6 : 3)); let k = 0;
    for (let q = 0; q < n; q++) { const u = (q - n / 2) * 0.5 + (hsh(seed, q, 2) - 0.5) * 0.2, v = (hsh(seed, q, 3) - 0.5) * 0.35, s = 0.85 + 0.5 * hsh(seed, q, 4), top = q > 2 && hsh(seed, q, 5) < 0.3;
      put('bag', x + tx * u - ty * v, y + ty * u + tx * v, SW + (top ? 0.36 : 0), hsh(seed, q, 6) * TAU, { s: [s, s * (0.8 + 0.4 * hsh(seed, q, 7)), s], tilt: [(hsh(seed, q, 8) - 0.5) * 0.5, (hsh(seed, q, 9) - 0.5) * 0.5] }); k++;
      if (q % 2 === 0) put('bagLod', x + tx * u, y + ty * u, SW, hsh(seed, q, 6) * TAU, { s: [1.5 * s, s, 1.2 * s] }); }
    const r = hsh(seed, 10), ex = (n / 2 + 0.7) * 0.5;
    if (r < 0.45) put('cbflat', x + tx * ex, y + ty * ex, SW, Math.atan2(ty, tx) + (r - 0.2), { s: 0.8 + r * 0.6, tilt: [0, r < 0.2 ? 0.9 : 0] });
    if (r > 0.3 && r < 0.7 && kinds.cbox) put('cbox', x - tx * ex, y - ty * ex, SW, r * 9, { s: 1.1 + r });
    if (r > 0.62 && kinds.crate) put('crate', x - tx * (ex + 0.5), y - ty * (ex + 0.5) + 0.1, SW, r * 5);
    if (r > 0.8 && kinds.can) put(r > 0.9 ? 'canRust' : 'can', x + tx * (ex + 0.75), y + ty * (ex + 0.75), SW, r * 7);
    scrapAt(x - ty * 0.5, y + tx * 0.5, seed); take(x, y, 0.5 + n * 0.25, 0); solid(x, y, 0.4);
  };
  dEach('bags', (x, y, z, h) => { if (free(x, y, 0.3)) bagPile(x, y, Math.cos(h), Math.sin(h), x * 3.1 + y, hsh(x, y, 51) < 0.5); });
  dEach('rack', (x, y, z, h) => { const r = hsh(x, y, 52); if (r < 0.62) { const s = r < 0.31 ? 1 : -1; put(bk(), x - Math.sin(h) * 0.13 * s, y + Math.cos(h) * 0.13 * s, SW, h + (hsh(x, y, 53) < 0.5 ? PI : 0), { tint: pick(TINTS.bike, hsh(x, y, 54)), tilt: [0.17 * s * (hsh(x, y, 53) < 0.5 ? -1 : 1), 0], s: 0.94 + 0.1 * hsh(x, y, 55) }); if (r < 0.12) put(bk(), x + Math.sin(h) * 0.14 * s, y - Math.cos(h) * 0.14 * s, SW, h + 0.05, { tint: pick(TINTS.bike, hsh(x, y, 56)), tilt: [-0.15 * s, 0] }); } });
  if (game.dressing && game.dressing.meshes) for (const m of game.dressing.meshes) {
    const k = m.userData.kind; if (hideKinds.has(k)) { m.userData.far = -1; m.userData.lod = true; m.visible = false; }
    else if (k === 'post' && m.isInstancedMesh) { const M4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0); let ch = false; for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M4); if (postKill.hit(M4.elements[12], -M4.elements[14], 0.05)) { m.setMatrixAt(i, zero); ch = true; } } if (ch) m.instanceMatrix.needsUpdate = true; }
  }

  // ================================================================= plazas: wide open paving gets tables, chairs, umbrellas, planters
  let SS = []; try { SS = await fetch(ctx.A + 'ground/shared_streets.json').then((r) => (r.ok ? r.json() : [])); } catch (e) { console.log('[streets] furniture: shared_streets.json not used: ' + (e && e.message)); }
  const laneSegs = []; for (const w of SS) for (let i = 0; i + 1 < (w.pts || []).length; i++) { const a = w.pts[i], b = w.pts[i + 1]; laneSegs.push([a[0], a[1], b[0], b[1], Math.min(a[0], b[0]) - 6, Math.min(a[1], b[1]) - 6, Math.max(a[0], b[0]) + 6, Math.max(a[1], b[1]) + 6]); }
  // distance to the centre line of the nearest shared-street lane (the lane is 3.3 m wide; furniture keeps 1.2 m off its edge)
  const laneDist = (x, y) => { let best = 99; for (const q of laneSegs) { if (x < q[4] || x > q[6] || y < q[5] || y > q[7]) continue; const dx = q[2] - q[0], dy = q[3] - q[1], t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (y - q[1]) * dy) / (dx * dx + dy * dy || 1e-9))); best = Math.min(best, Math.hypot(x - q[0] - dx * t, y - q[1] - dy * t)); } return best; };
  // racks with dark leaning bikes alongside each grate run, on the side away from the wall (placed first so the tables keep off them)
  let grateRacks = 0; const lanePt = (x, y, d = 3.1) => { for (let k = 0; k < 8; k++) { const a = k * PI / 4; if (statics.raycast(x, y, x + Math.cos(a) * d, y + Math.sin(a) * d) < 1) return true; } return false; };      // within 3.1 m of a wall: the walking lane
  const rackGroups = new Grid(40), grateSpots = [];
  gratesIn.forEach((g) => { if (!playable(g[0], g[1]) || rackGroups.hit(g[0], g[1], 68 + 12 * hsh(g[0], g[1], 93))) return; const nx = -g[3], ny = g[2], off = (g[5] || 0.56) + 0.8;
    const clr = (sgn) => { const x = g[0] + nx * off * sgn, y = g[1] + ny * off * sgn; return free(x, y, 0.7) && !lanePt(x, y) ? statics.raycast(x, y, x + nx * sgn * 9, y + ny * sgn * 9) : -1; };
    const c1 = clr(1), c2 = clr(-1); if (c1 < 0 && c2 < 0) return; const sgn = c1 >= c2 ? 1 : -1, h = Math.atan2(g[3], g[2]) + PI / 2, nb = 2 + (hsh(g[0], g[1], 94) < 0.45 ? 1 : 0); let done = 0;
    for (let q = 0; q < 2 && done < nb; q++) { const x = g[0] + nx * off * sgn + g[2] * q * 1.1, y = g[1] + ny * off * sgn + g[3] * q * 1.1; if (!free(x, y, 0.6) || lanePt(x, y)) continue; put('rack', x, y, SW, h); take(x, y, 0.75, 0.12); grateRacks++;
      for (const sg of [1, -1]) { if (done >= nb) break; put(bk(), x + g[2] * 0.2 * sg + nx * sgn * 0.12 * sg, y + g[3] * 0.2 * sg + ny * sgn * 0.12 * sg, SW, h + (sg > 0 ? 0 : PI), { tint: pick(TINTS.bike, hsh(g[0] + q, sg, 96)), tilt: [-0.13, 0] }); done++; } }
    if (done) { rackGroups.add(g[0], g[1], 0.1); grateSpots.push([g[0] + nx * off * sgn, g[1] + ny * off * sgn, g[2], g[3], nx * sgn, ny * sgn]); } });
  const plazaGrid = new Grid(6); let plazaSets = 0, binBudget = 2;
  const fillCell = (cx, cy, Z, ok) => {
      const r = hsh(cx, cy, 60); let x = cx + (hsh(cx, cy, 61) - 0.5) * 1.2, y = cy + (hsh(cx, cy, 62) - 0.5) * 1.2; [x, y] = offGrate(x, y, 0.45); if (!ok(x, y, 0.55) || laneDist(x, y) < 4.1 || (Z > 0.1 && lanePt(x, y, 4.9))) return false;
      if (r < 0.56 + 0.28 * hsh(Math.round(cx / 8), Math.round(cy / 8), 79)) { const um = r < 0.07, a0 = hsh(cx, cy, 63) * TAU, nc = 2 + Math.floor(hsh(cx, cy, 64) * 3.9); put('ptable', x, y, Z, a0, { tilt: [0, (hsh(cx, cy, 68) - 0.5) * 0.02] });
        for (let q = 0; q < nc; q++) { const a = a0 + q * TAU / nc + (hsh(cx, cy, 65 + q) - 0.5) * 1.3, d = 0.42 + 1.0 * hsh(cx + q, cy, 66) * hsh(cx, cy + q, 76), tip = hsh(cx + q, cy, 77) < 0.04; const kc = 0.2 + 0.3 * hsh(cx + q, cy, 80) * (0.6 + 0.8 * hsh(Math.round(cx / 12), Math.round(cy / 12), 89)), gr = hsh(cx + q, cy, 81) < 0.16; const [qx, qy] = offGrate(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.3); if (laneDist(qx, qy) < 3.1 || (Z > 0.1 && lanePt(qx, qy, 4.6))) continue; put('pchair', qx, qy, Z + (tip ? 0.2 : 0), a + PI + (hsh(cx + q, cy, 67) - 0.5) * 2.4, { tint: gr ? [0.22, 0.36, 0.04] : [kc, kc * 1.01, kc * 1.02], tilt: tip ? [1.45, 0] : [(hsh(cx + q, cy, 82) - 0.5) * 0.06, (hsh(cx + q, cy, 83) - 0.5) * 0.06], s: 0.94 + 0.1 * hsh(cx + q, cy, 84) }); }
        if (um) put('umbrellaC', x + 0.05, y + 0.05, Z, a0, { tint: TINTS.umb[0], tilt: [(hsh(cx, cy, 78) - 0.5) * 0.12, (hsh(cx, cy, 85) - 0.5) * 0.12], s: [1, 0.9 + 0.15 * hsh(cx, cy, 86), 1] }); take(x, y, 1.1, 0); solid(x, y, 0.36); plazaSets++; }
      else if (false) { put('planter' + Math.floor(hsh(cx, cy, 70) * 4), x, y, Z, r * 50, { s: 0.95 + 0.3 * hsh(cx, cy, 71) }); take(x, y, 1.0, 0.62); }
      else if (r < 0.86) { if (binBudget > 0) { binBudget--; put(hsh(cx, cy, 87) < 0.1 ? 'basketFull' : 'basket', x, y, Z, r * 50); take(x, y, 0.6, 0.3); } }
      else if (r < 0.985) { const hr = (meta.grid_deg || 0) * PI / 180 + Math.round(hsh(Math.round(cx / 30), Math.round(cy / 30), 72) * 2) * PI / 2, sg = r < 0.92 ? 1 : -1; put('rack', x, y, Z, hr); take(x, y, 0.9, 0.12); put(bk(), x - Math.sin(hr) * 0.17 * sg, y + Math.cos(hr) * 0.17 * sg, Z, hr, { tint: pick(TINTS.bike, hsh(cx, cy, 73)), tilt: [0.15 * sg, 0] }); if (hsh(cx, cy, 74) < 0.5) put(bk(), x + Math.sin(hr) * 0.2 * sg + Math.cos(hr) * 0.25, y - Math.cos(hr) * 0.2 * sg + Math.sin(hr) * 0.25, Z, hr + PI, { tint: pick(TINTS.bike, hsh(cx, cy, 75)), tilt: [0.15 * sg, 0], s: 0.93 }); }
      return true;
  };
  city.blocks.forEach((bl, bi) => {
    const bb = bbox(bl.ext); if (!playable((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2) || (bb[2] - bb[0]) > 900) return; const cells = [], G = 3.2;
    for (let x = bb[0] + G / 2; x < bb[2]; x += G) for (let y = bb[1] + G / 2; y < bb[3]; y += G) {
      if (bldAt(x, y) || !pip(x, y, bl.ext) || inPark(x, y) || distRing(x, y, bl.ext) < 2.8) continue; let ok = true;
      for (let k = 0; k < 8 && ok; k++) { const a = k * PI / 4; if (statics.raycast(x, y, x + Math.cos(a) * 5.0, y + Math.sin(a) * 5.0) < 1) ok = false; } if (!ok) continue;
      for (const h of bl.holes || []) if (pip(x, y, h)) ok = false; if (ok && !inPark(x + 3, y) && !inPark(x - 3, y) && !inPark(x, y + 3) && !inPark(x, y - 3)) cells.push([x, y]);
    }
    if (cells.length < 10 || Math.abs(area2(bl.ext)) / 2 > 3600) return;      // only the small open blocks the diagonal avenue leaves (traffic-island plazas)
    binBudget = 1 + (hsh(bi, 88) < 0.5 ? 1 : 0); let n = 0; for (const [cx, cy] of cells) { plazaGrid.add(cx, cy, 2.4); if (n < 90 && fillCell(cx, cy, SW, free)) n++; }
  });

  // ---- the mapped pedestrian plazas (roadway given to people; ground/plazas.json from the ground part): the same furniture inside,
  //      planters, granite blocks and delineators along the edge that faces traffic, an information kiosk on the larger ones
  const distToLane = (px, py, cx, cy, tx, ty) => Math.abs((px - cx) * -ty + (py - cy) * tx);
  const openAt = (x, y) => { for (let k = 0; k < 8; k++) { const a = k * PI / 4; if (statics.raycast(x, y, x + Math.cos(a) * 5.0, y + Math.sin(a) * 5.0) < 1) return false; } return true; };
  let osmPlazas = 0;
  try {
    const PZ = await fetch(ctx.A + 'ground/plazas.json').then((r) => (r.ok ? r.json() : []));
    for (const pz of PZ) {
      if (!pz.poly || pz.poly.length < 3 || pz.area < 120) continue; const ring = area2(pz.poly) > 0 ? pz.poly : pz.poly.slice().reverse(), bb = bbox(ring); if (!playable((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)) continue; osmPlazas++;
      const zAt = (x, y) => (statics.onSidewalk(x, y) ? SW : 0.03), inside = (x, y, m) => pip(x, y, ring) && distRing(x, y, ring) > m;
      const ok = (x, y, r) => playable(x, y) && inside(x, y, 0.5 + r * 0.6) && !occ.hit(x, y, r) && !bldAt(x, y) && !inPark(x, y) && (!statics.onSidewalk(x, y) || (inside(x, y, 2.6) && openAt(x, y)));      // on sidewalk level keep a walking lane at the edge and along the building line
      // the traffic edge first, so the tables keep clear of it
      let run = 1.5;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], SL = Math.hypot(b[0] - a[0], b[1] - a[1]); if (SL < 0.5) continue; const tx = (b[0] - a[0]) / SL, ty = (b[1] - a[1]) / SL, nx = -ty, ny = tx;
        for (; run < SL; run += 2.6 + 1.6 * hsh(i, run, 95)) { const kx = a[0] + tx * run, ky = a[1] + ty * run, ox = kx - nx * 1.3, oy = ky - ny * 1.3; if (statics.onSidewalk(ox, oy) || bldAt(ox, oy) || inPark(ox, oy)) continue;          // only where the roadway is on the other side
          const q = Math.floor(hsh(kx, ky, 96) * 4), x = kx + nx * 0.85, y = ky + ny * 0.85, Z = zAt(x, y); if (occ.hit(x, y, 0.8) || bldAt(x, y) || !playable(x, y) || laneDist(x, y) < 3.3) continue;
          if (q === 0) { put((hsh(kx, ky, 91) < 0.45 ? 'planter' + Math.floor(hsh(kx, ky, 97) * 4) : 'urn' + (1 + Math.floor(hsh(kx, ky, 92) * 1.99))), x, y, Z, kx, { s: 0.8 + 0.5 * hsh(kx, ky, 98) }); take(x, y, 0.9, 0.62); }
          else if (q === 1) { put('block', x, y, Z, Math.atan2(ty, tx) + (hsh(kx, ky, 99) - 0.5) * 0.5, { s: 0.85 + 0.3 * hsh(kx, ky, 98) }); take(x, y, 0.8, 0.5); }
          else { const dx2 = kx + nx * 0.3, dy2 = ky + ny * 0.3; put('delin', dx2, dy2, zAt(dx2, dy2), kx, { tilt: [(hsh(kx, ky, 97) - 0.5) * 0.16, (hsh(kx, ky, 98) - 0.5) * 0.16] }); take(dx2, dy2, 0.25, 0.06); } }
        run -= SL; }
      if (pz.area > 450) { const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length, cy = ring.reduce((s, q) => s + q[1], 0) / ring.length; if (ok(cx, cy, 0.8) && laneDist(cx, cy) > 3.6) { put('kiosk', cx, cy, zAt(cx, cy), (meta.grid_deg || 0) * PI / 180 + (hsh(cx, cy, 94) < 0.5 ? 0 : PI / 2)); take(cx, cy, 0.8, 0.35); } }
      binBudget = 1 + (hsh(bb[0], bb[1], 88) < 0.5 ? 1 : 0); const G = 2.7; let n = 0; for (let x = bb[0] + G / 2; x < bb[2]; x += G) for (let y = bb[1] + G / 2; y < bb[3]; y += G) if (n < 110 && inside(x, y, 1.6) && fillCell(x, y, zAt(x, y), ok)) n++;
    }
  } catch (e) { console.log('[streets] furniture: plazas.json not used: ' + (e && e.message)); }

  // ---- shared streets (ground/shared_streets.json: one slow lane on the centre line, the rest of the road width given to people):
  //      delineators along the lane edge, a line of planters and granite blocks 1.9 m off it, tables, racks and baskets behind
  let sharedM = 0;
  try {
    for (const way of SS) { const pts = way.pts || []; let run = 2;
      for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], SL = Math.hypot(b[0] - a[0], b[1] - a[1]); if (SL < 0.5) continue; const tx = (b[0] - a[0]) / SL, ty = (b[1] - a[1]) / SL, rot = Math.atan2(ty, tx);
        for (; run < SL; run += 3.0) { const cx = a[0] + tx * run, cy = a[1] + ty * run; if (!playable(cx, cy) || cornerDist(cx, cy) < 3) continue; const ne = nearEdge(cx, cy, 8), half = (ne ? ne.e.width : 11) / 2, k = Math.round((sharedM += 3) / 3);
          for (const sd of [-1, 1]) { const nx = -ty * sd, ny = tx * sd, P2 = (o) => [cx + nx * o, cy + ny * o], sdk = k * 2 + sd, okR = (x, y, r) => !statics.onSidewalk(x, y) && !occ.hit(x, y, r) && !bldAt(x, y);
            { const [x, y] = P2(2.0); if (hsh(sdk, 9) < 0.7 && okR(x, y, 0.2)) put('delin', x + tx * (hsh(sdk, 10) - 0.5) * 1.4, y + ty * (hsh(sdk, 10) - 0.5) * 1.4, 0.03, sdk, { s: [1, 0.8 + 0.25 * hsh(sdk, 11), 1], tilt: [(hsh(sdk, 1) - 0.5) * 0.14, (hsh(sdk, 2) - 0.5) * 0.14] }); }
            if (half < 4.4) continue;
            if (k % 2 === 0) { const [x, y] = P2(3.55 + 0.3 * hsh(sdk, 3)); if (okR(x, y, 0.8)) { if (hsh(sdk, 4) < 0.62) { put((hsh(sdk, 12) < 0.45 ? 'planter' + Math.floor(hsh(sdk, 5) * 4) : 'urn' + (1 + Math.floor(hsh(sdk, 13) * 1.99))), x, y, 0.03, sdk, { s: 0.8 + 0.5 * hsh(sdk, 6) }); take(x, y, 0.9, 0.62); } else { put('block', x, y, 0.03, rot + (hsh(sdk, 7) - 0.5) * 0.5, { s: 0.85 + 0.3 * hsh(sdk, 6) }); take(x, y, 0.8, 0.5); } } }
            if (half > 5.6) { const [x, y] = P2(4.7 + (half - 5.5) * hsh(sdk, 8)); SOLID = false; fillCell(x, y, 0.03, (px, py, r) => okR(px, py, r * 0.8)); SOLID = true; } } } run -= SL; } }
  } catch (e) { console.log('[streets] furniture: shared_streets.json not used: ' + (e && e.message)); }

  // ================================================================= park edges: iron fence with gates, benches inside, bins at the gates
  let fenceM = 0;
  for (const pk of parks) {
    const ring = area2(pk.ext) > 0 ? pk.ext : pk.ext.slice().reverse(); if (!playable((pk.bb[0] + pk.bb[2]) / 2, (pk.bb[1] + pk.bb[3]) / 2)) continue; let run = 12;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], SL = Math.hypot(b[0] - a[0], b[1] - a[1]); if (SL < 1.2) { run += SL; continue; }
      const tx = (b[0] - a[0]) / SL, ty = (b[1] - a[1]) / SL, nx = -ty, ny = tx, h = Math.atan2(ty, tx), n = Math.max(1, Math.round(SL / 2)), m = SL / n;
      for (let k = 0; k < n; k++) {
        const s = k * m, x = a[0] + tx * s, y = a[1] + ty * s, gate = (run % 52) < 4.2 && SL > 9; run += m;
        if (gate) { if ((run - m) % 52 < m) { for (let q = 0; q < 3; q++) { const bx = x + tx * (-0.7 - q * 0.62) + nx * 0.7, by = y + ty * (-0.7 - q * 0.62) + ny * 0.7; if (!occ.hit(bx, by, 0.3)) { put('pbin', bx, by, 0.18, h, { tint: TINTS.pbin[q] }); take(bx, by, 0.3, 0.28); } } } continue; }
        if (!playable(x, y)) continue;
        put('fence', x, y, SW, h, { s: [m / 2, 1, 1] }); fenceM += m;
        if (SOLID) statics.addSeg(x, y, x + tx * m, y + ty * m);     /* lead, Nov 11 (Matt: "I can like literally walk through the fence"): each panel is a wall to the player and to cars; the gates stay open */
        if (k % 6 === 3 && SL > 14) { const bx = x + nx * 1.5, by = y + ny * 1.5; if (!occ.hit(bx, by, 1.0)) { put('bench', bx, by, 0.18, h + PI); put('benchP', bx, by, 0.18, h + PI); take(bx, by, 1.0, 0); solid(bx - tx * 0.5, by - ty * 0.5, 0.35); solid(bx + tx * 0.5, by + ty * 0.5, 0.35); } }
      }
    }
  }

  // ================================================================= along every kerb
  const busGrid = new Grid(60), dockGrid = new Grid(80), counts = {};
  const cnt = (k) => { counts[k] = (counts[k] || 0) + 1; };
  city.blocks.forEach((bl, bi) => {
    const ring = area2(bl.ext) > 0 ? bl.ext : bl.ext.slice().reverse(), n = ring.length; if (Math.abs(area2(ring)) > 2e6) return;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], SL = Math.hypot(b[0] - a[0], b[1] - a[1]); if (SL < 10) continue;
      const tx = (b[0] - a[0]) / SL, ty = (b[1] - a[1]) / SL, nx = -ty, ny = tx, rot = Math.atan2(ty, tx); if (!playable((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
      const ne = nearEdge((a[0] + b[0]) / 2 - nx * 3, (a[1] + b[1]) / 2 - ny * 3), ave = !!(ne && ne.e.ave), busy = ave || !!(ne && !ne.e.oneway);
      let s = 4.5 + hsh(bi, i, 1) * 4, j = 0;
      while (s < SL - 4.5) {
        j++; const sd = bi * 7.13 + i * 131 + j, r = hsh(sd, 3), r2 = hsh(sd, 4), r3 = hsh(sd, 5), kx = a[0] + tx * s, ky = a[1] + ty * s, step = 6 + r3 * 3.5;
        const at = (inset, al = 0) => [kx + nx * inset + tx * al, ky + ny * inset + ty * al];
        s += step; if (cornerDist(kx, ky) < 6.5) continue;
        const wall = wallDist(kx, ky, nx, ny), park = inPark(kx + nx * 4, ky + ny * 4), plaza = !!plazaGrid.hit(kx + nx * 5.5, ky + ny * 5.5, 0.5), shed = !!shedGrid.hit(kx + nx * 0.7, ky + ny * 0.7, 3.2);
        if (wall !== null && wall < 2.4) continue;
        if (shed) {   // a work site by the sidewalk shed
          if (r < 0.3) { for (let q = 0; q < 3; q++) { const [x, y] = at(0.42, q * 1.7 - 1.7); if (free(x, y, 0.25)) { put('cone', x, y, SW, r * q * 9, { tilt: [0, q === 1 && r2 < 0.3 ? 1.45 : 0], s: 0.95 + 0.1 * r2 }); take(x, y, 0.3, 0.16); } } cnt('cones'); }
          else if (r < 0.5) { const [x, y] = at(0.55); if (free(x, y, 1.0)) { put('aframe', x, y, SW, rot + (r2 - 0.5) * 0.3, { cell: [r2 < 0.6 ? 0 : 1, 0] }); take(x, y, 1.0, 0); solid(x - tx * 0.6, y - ty * 0.6, 0.3); solid(x + tx * 0.6, y + ty * 0.6, 0.3); cnt('aframe'); } }
          else if (r < 0.66 && kinds.barrier) { for (let q = 0; q < 2 + (r2 < 0.4 ? 1 : 0); q++) { const [x, y] = at(0.5, q * 1.62); if (free(x, y, 0.8)) { put('barrier', x, y, SW, rot + (hsh(sd, q, 6) - 0.5) * 0.1); take(x, y, 0.85, 0); solid(x - tx * 0.45, y - ty * 0.45, 0.33); solid(x + tx * 0.45, y + ty * 0.45, 0.33); } } cnt('barrier'); }
          continue;
        }
        if (plaza) {   // the edge of a plaza: planters, granite blocks and delineators keep the traffic out
          const q = j % 4, [x, y] = at(q === 0 ? 0.95 : 0.7);
          if (q === 0 && free(x, y, 0.9)) { put((hsh(sd, 41) < 0.45 ? 'planter' + Math.floor(hsh(sd, 42) * 4) : 'urn' + (1 + Math.floor(hsh(sd, 43) * 1.99))), x, y, SW, r * 9, { s: 0.8 + 0.5 * r3 }); take(x, y, 0.9, 0.62); cnt('planter'); }
          else if (q === 1 && free(x, y, 0.8)) { put('block', x, y, SW, rot + (r2 - 0.5) * 0.5, { s: 0.85 + 0.3 * r3 }); take(x, y, 0.8, 0.5); cnt('block'); }
          else if (q === 3 && free(x, y, 0.75)) { put('rack', x, y, SW, rot + PI / 2); take(x, y, 0.75, 0.12); for (const sg of r2 < 0.5 ? [1, -1] : [1]) put(bk(), x + tx * 0.17 * sg, y + ty * 0.17 * sg, SW, rot + PI / 2 + (sg > 0 ? 0 : PI), { tint: pick(TINTS.bike, hsh(sd, 12 + sg)), tilt: [-0.16, 0] }); }
          else if (q === 2) for (let w = 0; w < 2; w++) { const [dx2, dy2] = at(0.35, w * 1.6); if (free(dx2, dy2, 0.2)) { put('delin', dx2, dy2, SW, r * 7, { tilt: [(hsh(sd, w, 7) - 0.5) * 0.16, (hsh(sd, w, 8) - 0.5) * 0.16] }); take(dx2, dy2, 0.25, 0.06); } }
          continue;
        }
        if (park) { if (r < 0.1) { const [x, y] = at(0.75); if (free(x, y, 0.5)) { put(r2 < 0.1 ? 'basketFull' : 'basket', x, y, SW, r * 77); take(x, y, 0.5, 0.3); } }
          else if (r < 0.24) for (let q = 0; q < 3; q++) { const [x, y] = at(1.0, q * 0.62); if (free(x, y, 0.3)) { put('pbin', x, y, SW, rot + r2, { tint: TINTS.pbin[q] }); take(x, y, 0.3, 0.28); } } continue; }
        if (hsh(sd, 15) < (ave ? 0.1 : 0.05)) { const [x, y] = at(0.6, 2.4); if (cornerDist(x, y) > 6 && free(x, y, 0.4)) { put('meter', x, y, SW, rot + PI / 2, { cell: [Math.floor(hsh(sd, 16) * 5), 1], tilt: [(hsh(sd, 17) - 0.5) * 0.04, 0] }); take(x, y, 0.4, 0.16); cnt('meter'); } }
        if (hsh(sd, 18) < 0.1) { const [x, y] = at(0.85, -2.3); if (cornerDist(x, y) > 6 && free(x, y, 0.75)) { put('rack', x, y, SW, rot + PI / 2); take(x, y, 0.75, 0.12); cnt('rack'); for (const sg of hsh(sd, 19) < 0.55 ? [1, -1] : [1]) put(bk(), x + tx * 0.17 * sg, y + ty * 0.17 * sg, SW, rot + PI / 2 + (sg > 0 ? 0 : PI), { tint: pick(TINTS.bike, hsh(sd, 20 + sg)), tilt: [-0.16, 0] }); } }
        if (ave && hsh(sd, 22) < 0.06) { const nq = 2 + Math.floor(hsh(sd, 23) * 3); for (let q = 0; q < nq; q++) { const [x, y] = at(0.55, -4.4 - q * 0.56); if (cornerDist(x, y) < 6 || !free(x, y, 0.3)) break; put('newsbox', x, y, SW, rot + PI / 2 + (hsh(sd, q, 24) - 0.5) * 0.14, { tint: pick(TINTS.news, hsh(sd, q, 25)), cell: [Math.floor(hsh(sd, q, 26) * 6), 0] }); take(x, y, 0.32, 0.28); } cnt('news'); }
        const deep = wall === null ? 9 : wall;
        if (ave && r < 0.1 && deep > 4.4 && !busGrid.hit(kx, ky, 110)) {
          const [x, y] = at(0.55); if (free(x, y, 0.4)) { put('busstop', x, y, SW, rot, { tilt: [(r2 - 0.5) * 0.03, 0] }); take(x, y, 0.4, 0.07); busGrid.add(kx, ky, 0.1); cnt('busstop');
            const [sx2, sy2] = at(1.45, -4.2); if (deep > 4.9 && s - step > 8 && free(sx2, sy2, 1.2) && free(sx2 + tx * 1.9, sy2 + ty * 1.9, 0.8) && free(sx2 - tx * 1.9, sy2 - ty * 1.9, 0.8)) { put('shelter', sx2, sy2, SW, rot + PI); take(sx2, sy2, 1.3, 0); for (const w of [-1.9, -0.95, 0, 0.95, 1.9]) { occ.add(sx2 + tx * w, sy2 + ty * w, 1.0); solid(sx2 + tx * w - nx * 0.5, sy2 + ty * w - ny * 0.5, 0.35); } cnt('shelter'); } }
        } else if (ave && r < 0.13 && deep > 4.2) { const [x, y] = at(0.8); if (free(x, y, 0.7)) { put('kiosk', x, y, SW, rot + (r2 < 0.5 ? PI : 0)); take(x, y, 0.7, 0); solid(x - nx * 0.25, y - ny * 0.25, 0.25); solid(x + nx * 0.25, y + ny * 0.25, 0.25); cnt('kiosk'); }
        } else if (busy && r < 0.17 && deep > 5.4 && SL - s > 10 && !dockGrid.hit(kx, ky, 160)) {
          const nd = 7 + Math.floor(r2 * 6); let ok = true; for (let q = -1; q <= nd && ok; q++) { const [x, y] = at(1.25, q * 0.78); if (!free(x, y, 0.5) || !free(x + nx * 0.9, y + ny * 0.9, 0.4)) ok = false; }
          if (ok) { dockGrid.add(kx, ky, 0.1); cnt('dock'); const tint = C('#1c7f8c');
            for (let q = 0; q < nd; q++) { const [x, y] = at(0.95, q * 0.78); put('dock', x, y, SW, rot + PI); occ.add(x, y, 0.5); occ.add(x + nx * 0.9, y + ny * 0.9, 0.5); if (q % 2 === 0) solid(x + nx * 0.1, y + ny * 0.1, 0.3);
              if (hsh(sd, q, 9) < 0.62) { put('bikeShare', x + nx * 0.47, y + ny * 0.47, SW + 0.06, rot - PI / 2, { tint }); if (q % 2 === 0) solid(x + nx * 0.7, y + ny * 0.7, 0.4); } }
            const [x, y] = at(1.0, -1.0); put('dockKiosk', x, y, SW, rot); take(x, y, 0.5, 0.3); }
        } else if (r < (ave ? 0.24 : 0.3) && wall !== null && deep < 9.5) { const [x, y] = at(0.62); if (free(x, y, 1.1)) { bagPile(x, y, tx, ty, sd, !ave && r2 < 0.6); cnt('bags'); }
        } else if (r < 0.36 && !ave && wall !== null && kinds.can) { const nq = 1 + Math.floor(r2 * 2.6); for (let q = 0; q < nq; q++) { const [x, y] = at(0.5 + 0.08 * q, q * 0.68); if (free(x, y, 0.33)) { put(hsh(sd, q, 10) < 0.45 ? 'canRust' : 'can', x, y, SW, hsh(sd, q, 11) * TAU); take(x, y, 0.36, 0.3); } } if (r2 < 0.4) scrapAt(...at(0.7, -0.6), sd); cnt('cans');
        } else if (r < 0.44) { const [x, y] = at(0.8); if (free(x, y, 0.75)) { put('rack', x, y, SW, rot + PI / 2); take(x, y, 0.75, 0.12); cnt('rack'); if (r2 < 0.75) { const sg = r2 < 0.4 ? 1 : -1; put(bk(), x + tx * 0.13 * sg, y + ty * 0.13 * sg, SW, rot + PI / 2 + (r3 < 0.5 ? PI : 0), { tint: pick(TINTS.bike, hsh(sd, 12)), tilt: [0.17 * sg * (r3 < 0.5 ? 1 : -1), 0] }); } }
        } else if (r < 0.48 && deep > 4.0 && kinds.chalk) { const [x, y] = at(0.85); if (free(x, y, 0.55)) { put('chalk', x, y, SW, rot + PI / 2 + (r2 - 0.5) * 0.5, { s: 0.72 }); take(x, y, 0.55, 0.3); cnt('chalk'); }
        } else if (r < 0.52 && deep > 5.0 && kinds.cafe && busy) { for (let q = 0; q < 2; q++) { const [x, y] = at(1.05, q * 2.1); if (free(x, y, 0.95)) { put('cafe', x, y, SW, rot + r2 * 0.6 + q); take(x, y, 0.95, 0.5); } } cnt('cafe');
        } else if (r < 0.58 && ave && deep > 4.2) { const nU = 2 + Math.floor(r3 * 2.99); for (let q = 0; q < nU; q++) { const [x, y] = at(0.9, q * 1.9); if (cornerDist(x, y) > 6 && free(x, y, 0.72)) { put('urn' + Math.floor(r2 * 2), x, y, SW, r * 99 + q, { s: 0.92 + 0.2 * hsh(sd, q, 40) }); take(x, y, 0.75, 0.6); } } cnt('urns');
        } else if (r < 0.66) { const [x, y] = at(0.2 + r2 * 0.5); if (free(x, y, 0.1)) scrapAt(x, y, sd);
        } else if (r < 0.7 && (kinds.cbox || kinds.crate) && wall !== null) { const [x, y] = at(0.6); if (free(x, y, 0.5)) { if (kinds.cbox) put('cbox', x, y, SW, r2 * 9, { s: 1 + r3 }); if (kinds.crate && r2 < 0.6) put('crate', x + tx * 0.6, y + ty * 0.6, SW, r3 * 9); put('cbflat', x - tx * 0.8, y - ty * 0.8, SW, rot + r2); take(x, y, 0.9, 0.3); cnt('boxes'); } }
      }
    }
  });

  let shopN = 0; const shops = ctx.parts && ctx.parts.storefronts && ctx.parts.storefronts.shops;
  if (shops) for (const sp of shops) {
    if (sp.shed || sp.stand || !(sp.kerb > 3.4) || !(sp.w > 2.2)) continue; const off = (sp.out || 0.1) + 0.5; const r = hsh(sp.x, sp.y, 88); if (r > (sp.food ? 0.6 : 0.08)) continue;
    const ax = Math.cos(sp.h), ay = Math.sin(sp.h), side = (sp.door || 0) >= 0 ? -1 : 1, room = sp.w / 2 - 0.45; if (room < 0.5) continue;
    const at = (al, out) => [sp.x + ax * al + sp.nx * out, sp.y + ay * al + sp.ny * out], a1 = side * Math.min(room, 1.0 + r);
    if (Math.abs(a1 - (sp.door || 0)) < 0.9) continue;                                   // keep the doorway clear
    const [x, y] = at(a1, off); if (!free(x, y, 0.45)) continue; shopN++;
    if (kinds.chalk && (r < 0.38 || !sp.food)) { put('chalk', x, y, SW, sp.h + (hsh(sp.x, sp.y, 89) < 0.5 ? 0 : PI) + (hsh(sp.x, sp.y, 90) - 0.5) * 0.5, { s: 0.72 }); take(x, y, 0.45, 0.3); }
    else if (sp.kerb > 4.2) { put('ptable', x, y, SW, sp.h, { s: 0.88 }); take(x, y, 0.55, 0.3); for (const sg of [-1, 1]) { const al = a1 + sg * 0.6; if (Math.abs(al) < room + 0.2 && Math.abs(al - (sp.door || 0)) > 0.7) put('pchair', sp.x + ax * al + sp.nx * (off - 0.1), sp.y + ay * al + sp.ny * (off - 0.1), SW, sp.h + (sg > 0 ? PI : 0) + (hsh(sp.x, sg, 91) - 0.5) * 0.8, { tint: hsh(sp.x, sp.y, 92) < 0.6 ? [0.1, 0.17, 0.03] : [0.62, 0.63, 0.64] }); } }
  }

  // ================================================================= pipe scaffolding over some of the sidewalk sheds
  let scafBays = 0;
  dEach('shed_deck', (x, y, z, h, sa) => {
    const ix = -Math.sin(h), iy = Math.cos(h), b = bldAt(x + Math.cos(h) * 1.2 * sa + ix * 1.2, y + Math.sin(h) * 1.2 * sa + iy * 1.2); if (!b || b.h < 14) return; const id = b.id ?? Math.round(b.poly[0][0] * 7 + b.poly[0][1]);
    if (hsh(id, 81) > 0.34) return; const lifts = Math.max(2, Math.min(5, Math.floor((b.h - 4.2) / 2) - Math.floor(hsh(id, 82) * 3))), tint = pick(TINTS.net, hsh(id, 83)), netted = hsh(id, 84) < 0.75;
    for (let q = 0; q < lifts; q++) { put('scaf', x, y, SW + 2.64 + q * 2.0, h, { s: [sa, 1, 1] }); if (netted && (q > 0 || hsh(id, 85) < 0.5)) put('net', x, y, SW + 2.64 + q * 2.0, h, { s: [sa, 1, 1], tint }); } scafBays++;
  });

  let shedBays = 0;
  dEach('shed_deck', (x, y, z, h, sa, sd) => { put('shedUnder', x, y, z, h, { s: [sa, 1, sd] }); shedBays++; });
  dEach('shed_parapet', (x, y, z, h, sa) => { if (sa < 4.5) return; const r = hsh(x, y, 87), al = Math.min(sa * 0.5, 2.2 + r * 3), cx = Math.cos(h), cy = Math.sin(h);
    put('shedBoard', x + cx * al, y + cy * al, z + 2.85, h, { cell: [Math.floor(r * 3), 0] }); if (sa > 7) put('shedPermit', x + cx * (al + 1.5), y + cy * (al + 1.5), z + 2.9, h, { tilt: [0, (r - 0.5) * 0.08] }); });

  // ================================================================= build the instanced meshes
  const hidden = ['signal', 'light', 'hydrant', 'bin', 'meter', 'newsbox'];
  for (const m of game.propMeshes || []) if (hidden.includes(m.userData.kind)) { if (m.userData.kind === 'hydrant' && !kinds.hydrant && !kinds.hydLod) continue; m.visible = false; }
  const meshes = []; let instances = 0, tris = 0; const M4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3();
  for (const name of Object.keys(kinds)) {
    const K = kinds[name]; if (!K.list.length) continue; const tiles = new Map(), triK = K.parts.reduce((t, q) => t + (q.geometry.index ? q.geometry.index.count : q.geometry.attributes.position.count) / 3, 0), T = K.list.length * triK < 80000 ? 380 : 190;      // big tiles only for kinds that are cheap in total: a tile is drawn whole
    for (const it of K.list) { const k = Math.floor(it[0] / T) + ',' + Math.floor(it[1] / T); let a = tiles.get(k); if (!a) tiles.set(k, (a = [])); a.push(it); }
    for (const [key, items] of tiles) {
      const [ti, tj] = key.split(',').map(Number);
      for (const part of K.parts) {
        const isF = part.material === fMat || part.material === netMat, n = items.length, fc = K.fam ? A.cells[K.fam] : null;
        const g = new THREE.BufferGeometry(); for (const a in part.geometry.attributes) g.setAttribute(a, part.geometry.attributes[a]); g.setIndex(part.geometry.index); g.boundingSphere = part.geometry.boundingSphere; g.boundingBox = part.geometry.boundingBox;
        const im = new THREE.InstancedMesh(g, part.material, n), tint = isF ? new Float32Array(n * 3).fill(1) : null, cell = isF ? new Float32Array(n * 2) : null;
        for (let i = 0; i < n; i++) {
          const it = items[i], o = it[4]; if (o && o.q) q4.copy(o.q); else { e4.set(o && o.tilt ? o.tilt[0] : 0, it[3], o && o.tilt ? o.tilt[1] : 0, 'YXZ'); q4.setFromEuler(e4); } v4.set(it[0], it[2], -it[1]);
          if (o && o.s !== undefined) { if (typeof o.s === 'number') s4.setScalar(o.s); else s4.set(o.s[0], o.s[1], o.s[2]); } else s4.set(1, 1, 1); if (K.scale) s4.multiplyScalar(K.scale);
          M4.compose(v4, q4, s4); im.setMatrixAt(i, M4);
          if (isF && o) { if (o.tint) tint.set(o.tint, i * 3); if (o.cell && fc) { cell[i * 2] = o.cell[0] * fc.du; cell[i * 2 + 1] = o.cell[1] * fc.dv; } }
        }
        if (isF) { g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3)); g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2)); }
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix();
        im.castShadow = K.shadow && !part.noShadow; im.receiveShadow = true; im.name = 'st_' + name; if (part.material.transparent) im.renderOrder = 3;
        im.userData = { kind: 'st_' + name, far: K.far, near: K.near, cx: (ti + 0.5) * T, cz: -(tj + 0.5) * T, r: T * 0.7072 };
        group.add(im); meshes.push(im); instances += n; tris += n * (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    }
  }
  const prev = world.scene.onBeforeRender;
  world.scene.onBeforeRender = function (renderer, scene, camera, rt) {
    if (prev) prev.call(this, renderer, scene, camera, rt);
    if (!camera.isPerspectiveCamera || !group.visible) return; const p = camera.position;
    for (const m of meshes) { const u = m.userData, d = Math.max(0, Math.hypot(p.x - u.cx, p.z - u.cz) - u.r); m.visible = !u.off && d < u.far && (u.near === 0 || d >= u.near); }
  };
  world.scene.add(group);
  const kc = {}; for (const k in kinds) if (kinds[k].list.length) kc[k] = kinds[k].list.length;
  console.log('[streets] furniture kinds ' + JSON.stringify(kc) + ' kerb ' + JSON.stringify(counts));
  return { group, meshes, kinds, grateSpots, report: { instances, ktris: Math.round(tris / 1000), signals: sigs.length, lights: (city.props.light || []).length, plazaSets, fence_m: Math.round(fenceM), scafBays, shedBays, osmPlazas, shops: shopN, grates: gratesIn.length, grateRacks, shared_m: sharedM, circles: circles.n } };
}
