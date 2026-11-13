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
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
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
    if (i === 2) { g.fillStyle = 'rgba(120,120,120,0.10)'; for (let k = 0; k < 12; k++) g.fillRect(0, k * 8, w, 1); } else { g.fillStyle = 'rgba(6,6,6,0.5)'; for (let k = 0; k < 32; k++) { g.fillRect(0, k * 3, w, 1); g.fillRect(k * 3, 0, 1, h); } }
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
    g.fillStyle = '#0a5c3c'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(233,239,233,0.55)'; g.lineWidth = 1; g.strokeRect(1.5, 1.5, w - 3, h - 3); txt(names[i], w / 2, h / 2 + 1, 33, '#f3f6f1', w - 18, '600'); fade(w, h, 0.07); grime(w, h, 8, 200 + i);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex: t, cells };
}

// ------------------------------------------------------------------------------------------------ sign lettering
// A stroke alphabet for road signs (capitals and digits), drawn by this file: uniform stroke, flat cut ends, in the manner of the US
// highway alphabets (which are public-domain federal standards). No font file, so signs read the same on every machine.
// A glyph: [width, paths...]; a path is a flat list of commands in units of the cap height, y up from the baseline:
//   'M',x,y  'L',x,y  'E',cx,cy,rx,ry,a0,a1 (ellipse arc, degrees, counter-clockwise when a1 > a0)  'Q',cx,cy,x,y
const GA = 0.082;      // half the stroke
const GLY = (() => { const a = GA, T = 1 - a, B = a, M = 0.5, G = {};
  const st = (w) => ['M', a, -0.1, 'L', a, 1.1];                     // left stem (cut by the clip)
  G.A = [0.80, ['M', a - 0.035, -0.1, 'L', 0.40, 1.02, 'L', 0.80 - a + 0.035, -0.1], ['M', 0.2, 0.3, 'L', 0.6, 0.3]];
  G.B = [0.68, st(), ['M', a, T, 'L', 0.37, T, 'E', 0.37, (T + M + 0.02) / 2, 0.215, (T - M - 0.02) / 2, 90, -90, 'L', a, M + 0.02], ['M', a, M + 0.02, 'L', 0.38, M + 0.02, 'E', 0.38, (M + 0.02 + B) / 2, 0.22, (M + 0.02 - B) / 2, 90, -90, 'L', a, B]];
  G.C = [0.68, ['E', 0.36, 0.5, 0.36 - a, 0.5 - a, 42, 318]];
  G.D = [0.70, st(), ['M', a, T, 'L', 0.3, T, 'E', 0.3, 0.5, 0.70 - a - 0.3, 0.5 - a, 90, -90, 'L', a, B]];
  G.E = [0.62, st(), ['M', a, T, 'L', 0.7, T], ['M', a, M + 0.02, 'L', 0.5, M + 0.02], ['M', a, B, 'L', 0.7, B]];
  G.F = [0.60, st(), ['M', a, T, 'L', 0.7, T], ['M', a, M + 0.02, 'L', 0.48, M + 0.02]];
  G.G = [0.70, ['E', 0.36, 0.5, 0.36 - a, 0.5 - a, 42, 345, 'L', 0.70 - a, 0.46, 'L', 0.42, 0.46]];
  G.H = [0.70, st(), ['M', 0.70 - a, -0.1, 'L', 0.70 - a, 1.1], ['M', a, M + 0.01, 'L', 0.70 - a, M + 0.01]];
  G.I = [2 * a, ['M', a, -0.1, 'L', a, 1.1]];
  G.J = [0.56, ['M', 0.56 - a, 1.1, 'L', 0.56 - a, 0.32, 'E', 0.28, 0.32, 0.28 - a, 0.32 - a, 0, -168]];
  G.K = [0.72, st(), ['M', 0.76, 1.06, 'L', a, 0.36], ['M', 0.30, 0.58, 'L', 0.76, -0.06]];
  G.L = [0.58, st(), ['M', a, B, 'L', 0.7, B]];
  G.M = [0.86, ['M', a, -0.1, 'L', a, T, 'L', 0.43, 0.2, 'L', 0.86 - a, T, 'L', 0.86 - a, -0.1]];
  G.N = [0.72, ['M', a, -0.1, 'L', a, T + 0.02, 'L', 0.72 - a, B - 0.02, 'L', 0.72 - a, 1.1]];
  G.O = [0.72, ['E', 0.36, 0.5, 0.36 - a, 0.5 - a, 0, 360]];
  G.P = [0.66, st(), ['M', a, T, 'L', 0.36, T, 'E', 0.36, T - 0.225, 0.66 - a - 0.36, 0.225, 90, -90, 'L', a, T - 0.45]];
  G.Q = [0.72, ['E', 0.36, 0.5, 0.36 - a, 0.5 - a, 0, 360], ['M', 0.42, 0.3, 'L', 0.74, -0.04]];
  G.R = [0.68, st(), ['M', a, T, 'L', 0.36, T, 'E', 0.36, T - 0.225, 0.68 - a - 0.36, 0.225, 90, -90, 'L', a, T - 0.45], ['M', 0.36, T - 0.45, 'L', 0.68 - a + 0.03, -0.1]];
  G.S = [0.66, ['E', 0.33, T - 0.215, 0.33 - a - 0.01, 0.215, 28, 270, 'E', 0.33, B + 0.225, 0.33 - a, 0.225, 90, -152]];
  G.T = [0.62, ['M', -0.1, T, 'L', 0.72, T], ['M', 0.31, T, 'L', 0.31, -0.1]];
  G.U = [0.70, ['M', a, 1.1, 'L', a, 0.35, 'E', 0.35, 0.35, 0.35 - a, 0.35 - a, 180, 360, 'L', 0.70 - a, 1.1]];
  G.V = [0.76, ['M', a - 0.035, 1.1, 'L', 0.38, -0.02, 'L', 0.76 - a + 0.035, 1.1]];
  G.W = [1.02, ['M', a - 0.03, 1.1, 'L', 0.29, -0.02, 'L', 0.51, 0.86, 'L', 0.73, -0.02, 'L', 1.02 - a + 0.03, 1.1]];
  G.X = [0.72, ['M', a - 0.05, 1.1, 'L', 0.72 - a + 0.05, -0.1], ['M', 0.72 - a + 0.05, 1.1, 'L', a - 0.05, -0.1]];
  G.Y = [0.74, ['M', a - 0.04, 1.1, 'L', 0.37, 0.47, 'L', 0.74 - a + 0.04, 1.1], ['M', 0.37, 0.47, 'L', 0.37, -0.1]];
  G.Z = [0.66, ['M', a, T, 'L', 0.66 - a - 0.02, T, 'L', a + 0.02, B, 'L', 0.66 - a, B]];
  G['0'] = [0.66, ['E', 0.33, 0.5, 0.33 - a, 0.5 - a, 0, 360]];
  G['1'] = [0.36, ['M', 0.36 - a, -0.1, 'L', 0.36 - a, T + 0.03, 'L', -0.02, 0.68]];
  G['2'] = [0.66, ['E', 0.33, T - 0.235, 0.33 - a, 0.235, 165, -38, 'L', a + 0.01, B, 'L', 0.75, B]];
  G['3'] = [0.66, ['E', 0.33, T - 0.21, 0.33 - a - 0.015, 0.21, 152, -90, 'E', 0.33, B + 0.228, 0.33 - a, 0.228, 90, -152]];
  G['4'] = [0.70, ['M', 0.5, -0.1, 'L', 0.5, T + 0.03, 'L', a - 0.01, 0.31, 'L', 0.8, 0.31]];
  G['5'] = [0.66, ['M', 0.62, T, 'L', a + 0.06, T, 'L', a + 0.02, 0.56, 'E', 0.33, B + 0.265, 0.33 - a, 0.265, 132, -152]];
  G['6'] = [0.66, ['E', 0.33, B + 0.262, 0.33 - a, 0.262, 0, 360], ['M', a, B + 0.3, 'Q', a + 0.01, 0.86, 0.5, 0.97]];
  G['7'] = [0.64, ['M', -0.1, T, 'L', 0.64 - a + 0.02, T, 'L', 0.26, -0.1]];
  G['8'] = [0.66, ['E', 0.33, T - 0.2, 0.33 - a - 0.03, 0.2, 0, 360], ['E', 0.33, B + 0.24, 0.33 - a, 0.24, 0, 360]];
  G['9'] = [0.66, ['E', 0.33, T - 0.262, 0.33 - a, 0.262, 0, 360], ['M', 0.66 - a, T - 0.3, 'Q', 0.66 - a - 0.01, 0.14, 0.16, 0.03]];
  G['-'] = [0.4, ['M', 0.04, 0.5, 'L', 0.36, 0.5]]; G['&'] = G['8']; G['.'] = [0.2, ['M', 0.1, 0.0, 'L', 0.1, 0.17]]; G[' '] = [0.36];
  return G; })();
const GSP = 0.17;      // gap between letters
function gothicWidth(s, h, track = 1) { let w = 0; for (const ch of s) { const gl = GLY[ch] || GLY[' ']; w += gl[0] + GSP * track; } return (w - GSP * track) * h; }
// draw s with cap height h, its baseline at y, starting at x (align 'l') or centred on x ('c'); returns the width drawn
function gothic(g, s, x, y, h, col, o = {}) {
  s = s.toUpperCase(); const track = o.track ?? 1; let w = gothicWidth(s, h, track), sx = 1; if (o.maxW && w > o.maxW) { sx = o.maxW / w; w = o.maxW; }
  let px = o.align === 'c' ? x - w / 2 : x; g.save(); g.strokeStyle = col; g.lineWidth = 2 * GA * h * (o.weight || 1); g.lineJoin = 'miter'; g.miterLimit = 3; g.lineCap = 'butt';
  for (const ch of s) { const gl = GLY[ch] || GLY[' ']; g.save(); g.translate(px, y); g.scale(sx, 1); g.beginPath(); g.rect(-0.02 * h, -h, (gl[0] + 0.04) * h, h); g.clip();
    for (let q = 1; q < gl.length; q++) { const p = gl[q]; g.beginPath(); let i = 0, first = true;
      while (i < p.length) { const c = p[i];
        if (c === 'M') { g.moveTo(p[i + 1] * h, -p[i + 2] * h); i += 3; }
        else if (c === 'L') { g.lineTo(p[i + 1] * h, -p[i + 2] * h); i += 3; }
        else if (c === 'Q') { g.quadraticCurveTo(p[i + 1] * h, -p[i + 2] * h, p[i + 3] * h, -p[i + 4] * h); i += 5; }
        else if (c === 'E') { const a0 = p[i + 5] * Math.PI / 180, a1 = p[i + 6] * Math.PI / 180; g.ellipse(p[i + 1] * h, -p[i + 2] * h, p[i + 3] * h, p[i + 4] * h, 0, -a0, -a1, a1 > a0); i += 7; }
        else i++; first = false; }
      g.stroke(); }
    g.restore(); px += (gl[0] + GSP * track) * h * sx; }
  g.restore(); return w; }

// ------------------------------------------------------------------------------------------------ the hero sign sheet
// A second canvas for the signs of the hero blocks, drawn four times finer than the atlas cells and lettered with the stroke alphabet:
// street-name blades, one-way plates, regulation plates, the LED faces of the pedestrian signals.
function makeHeroSheet(names) {
  const W = 2048, H = 2048, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); const cells = {}, PAD = 4;
  const fam = (name, x0, y0, w, h, n, cols, draw) => {
    for (let i = 0; i < n; i++) { const x = x0 + (i % cols) * (w + PAD) + PAD / 2, y = y0 + Math.floor(i / cols) * (h + PAD) + PAD / 2; g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, i, w, h); g.restore(); }
    const e = 1.5; cells[name] = { u0: (x0 + PAD / 2 + e) / W, u1: (x0 + PAD / 2 + w - e) / W, v0: 1 - (y0 + PAD / 2 + h - e) / H, v1: 1 - (y0 + PAD / 2 + e) / H, du: (w + PAD) / W, dv: -(h + PAD) / H, cols, n };
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath(); };
  // reflective sheeting: a faint lattice; weather: a few pale streaks and specks
  const sheet = (w, h, a) => { g.save(); g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1; g.beginPath(); for (let k = -h; k < w + h; k += 9) { g.moveTo(k, 0); g.lineTo(k + h * 0.577, h); g.moveTo(k, 0); g.lineTo(k - h * 0.577, h); } g.stroke(); g.restore(); };
  const cells2 = (w, h, a) => { g.save(); g.strokeStyle = `rgba(20,30,24,${a})`; g.lineWidth = 0.7; g.beginPath(); for (let k = -h; k < w + h; k += 5) { g.moveTo(k, 0); g.lineTo(k + h * 0.577, h); g.moveTo(k, 0); g.lineTo(k - h * 0.577, h); } g.stroke(); g.restore(); };
  const cells3 = (w, h, a) => { g.save(); g.strokeStyle = `rgba(16,26,20,${a})`; g.lineWidth = 1.1; g.beginPath(); for (let k = -h; k < w + h; k += 8) { g.moveTo(k, 0); g.lineTo(k + h * 0.577, h); g.moveTo(k, 0); g.lineTo(k - h * 0.577, h); } g.stroke(); g.restore(); };
  const edgeDirt = (w, h, seed) => { const gr = g.createLinearGradient(0, h * 0.78, 0, h); gr.addColorStop(0, 'rgba(40,36,28,0)'); gr.addColorStop(1, 'rgba(40,36,28,0.22)'); g.fillStyle = gr; g.fillRect(0, h * 0.78, w, h * 0.22); for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(40,36,28,${0.05 + 0.06 * hsh(i, seed, 7)})`; g.fillRect(hsh(i, seed, 8) * w, 0, 3 + hsh(i, seed, 9) * 7, h * (0.2 + 0.5 * hsh(i, seed, 10))); } };
  const weather = (w, h, seed, k) => { for (let i = 0; i < k; i++) { const a = hsh(i, seed), b = hsh(i, seed, 2), d = hsh(i, seed, 3); g.fillStyle = d < 0.6 ? `rgba(40,36,28,${0.02 + 0.03 * hsh(i, seed, 4)})` : `rgba(235,235,225,${0.015 + 0.025 * hsh(i, seed, 4)})`; g.fillRect(a * w, b * h, 6 + d * 16, 20 + hsh(i, seed, 5) * h * 0.6); } };
  fam('blade', 0, 0, 1020, 228, Math.max(1, names.length), 1, (g, i, w, h) => {
    g.fillStyle = '#0b7c52'; g.fillRect(0, 0, w, h); { const tg = g.createLinearGradient(0, 0, w, h); tg.addColorStop(0, 'rgba(255,255,255,0.07)'); tg.addColorStop(0.45, 'rgba(255,255,255,0)'); tg.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = tg; g.fillRect(0, 0, w, h); for (let q = 0; q < 5; q++) { const bx = hsh(q, i, 61) * w, by = hsh(q, i, 62) * h, br = 60 + 160 * hsh(q, i, 63), bg = g.createRadialGradient(bx, by, 0, bx, by, br); bg.addColorStop(0, hsh(q, i, 64) < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bg; g.fillRect(0, 0, w, h); } }
    g.strokeStyle = '#e9eee8'; g.lineWidth = 7; rr(13, 13, w - 26, h - 26, 15); g.stroke();
    const nm = (names[i] || 'Broadway').toUpperCase(), m = nm.match(/^(?:([EWNS]) )?(.*?)(?: (ST|AV|AVE|PL|SQ|RD|BLVD|S))?$/), cap = h * 0.6, base = h / 2 + cap / 2, col = '#f6f9f4';
    const pre = m && m[1] ? m[1] : '', mid = m ? m[2] : nm, suf = m && m[3] ? m[3] : '', sc = 0.58, gp = cap * 0.42;
    let tw = (pre ? gothicWidth(pre, cap) + gp : 0) + gothicWidth(mid, cap) + (suf ? gp * 0.6 + gothicWidth(suf, cap * sc) : 0); const k = Math.min(1, (w - 90) / tw); let x = w / 2 - tw * k / 2;
    if (pre) { x += gothic(g, pre, x, base, cap, col, { maxW: gothicWidth(pre, cap) * k }) + gp * k; }
    x += gothic(g, mid, x, base, cap, col, { maxW: gothicWidth(mid, cap) * k });
    if (suf) gothic(g, suf, x + gp * 0.6 * k, base - cap * (1 - sc), cap * sc, col, { maxW: gothicWidth(suf, cap * sc) * k });
    cells3(w, h, 0.12); edgeDirt(w, h, 300 + i); edgeDirt(w, h, 311 + i); weather(w, h, 300 + i, 22); for (let q = 0; q < 7; q++) { g.strokeStyle = `rgba(225,232,226,${0.1 + 0.16 * hsh(q, i, 71)})`; g.lineWidth = 0.8 + hsh(q, i, 72); g.beginPath(); const sx = hsh(q, i, 73) * w, sy = hsh(q, i, 74) * h; g.moveTo(sx, sy); g.lineTo(sx + (hsh(q, i, 75) - 0.5) * 140, sy + (hsh(q, i, 76) - 0.5) * 50); g.stroke(); }
    { const eg = g.createLinearGradient(0, h - 16, 0, h); eg.addColorStop(0, 'rgba(30,26,20,0)'); eg.addColorStop(1, 'rgba(30,26,20,0.5)'); g.fillStyle = eg; g.fillRect(0, h - 16, w, 16); }
  });
  fam('oneway', 0, 940, 1020, 336, 2, 1, (g, i, w, h) => {
    const dir = i ? -1 : 1; g.fillStyle = '#121212'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ecece8'; g.lineWidth = 8; rr(12, 12, w - 24, h - 24, 18); g.stroke();
    g.save(); g.translate(w / 2, h / 2); g.scale(dir, 1); g.fillStyle = '#f3f3ef'; g.beginPath(); g.moveTo(-0.435 * w, -0.215 * h); g.lineTo(0.215 * w, -0.215 * h); g.lineTo(0.215 * w, -0.36 * h); g.lineTo(0.45 * w, 0); g.lineTo(0.215 * w, 0.36 * h); g.lineTo(0.215 * w, 0.215 * h); g.lineTo(-0.435 * w, 0.215 * h); g.closePath(); g.fill(); g.restore();
    gothic(g, 'ONE WAY', w / 2 - 0.09 * w * dir, h / 2 + 0.118 * h, 0.236 * h, '#121212', { align: 'c', weight: 1.08 }); cells2(w, h, 0.07); edgeDirt(w, h, 320 + i); weather(w, h, 320 + i, 12);
  });
  const PS = [['r', 'NO', 'STANDING', 'ANYTIME'], ['r', 'NO PARKING', '8AM-6PM', 'MON THRU FRI'], ['r', 'NO', 'STOPPING', 'ANYTIME'], ['r', 'TRUCK', 'LOADING', 'ONLY', '7AM-7PM']];
  fam('park', 1028, 0, 380, 570, 4, 2, (g, i, w, h) => {
    const P = PS[i], col = '#b5231c'; g.fillStyle = '#efeee8'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 12; rr(16, 16, w - 32, h - 32, 26); g.stroke();
    const lines = P.slice(1), top = 78, room = h * 0.6, lh = room / lines.length, cap = Math.min(64, lh * 0.62); lines.forEach((t, k) => gothic(g, t, w / 2, top + lh * k + (lh + cap) / 2, cap, col, { align: 'c', maxW: w - 86 }));
    const ay = h - 86; g.fillStyle = col; g.fillRect(w * 0.27, ay - 8, w * 0.46, 16); g.beginPath(); g.moveTo(w * 0.14, ay); g.lineTo(w * 0.3, ay - 30); g.lineTo(w * 0.3, ay + 30); g.fill(); if (i !== 3) { g.beginPath(); g.moveTo(w * 0.86, ay); g.lineTo(w * 0.7, ay - 30); g.lineTo(w * 0.7, ay + 30); g.fill(); }
    g.fillStyle = '#8d8f8c'; g.beginPath(); g.arc(w / 2, 38, 8, 0, TAU); g.arc(w / 2, h - 36, 8, 0, TAU); g.fill(); cells2(w, h, 0.07); edgeDirt(w, h, 340 + i); weather(w, h, 340 + i, 14);
  });
  fam('white', 1900, 1900, 48, 48, 1, 1, (g, i, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(-4, -4, w + 8, h + 8); });
  // the pedestrian faces: a hand and a walking figure made of LED dots
  fam('ped', 1028, 1160, 384, 384, 2, 2, (g, i, w, h) => {
    g.fillStyle = '#1b1c1f'; g.fillRect(0, 0, w, h); { const sg2 = g.createLinearGradient(0, 0, w, h); sg2.addColorStop(0, 'rgba(120,128,140,0.10)'); sg2.addColorStop(0.5, 'rgba(0,0,0,0)'); sg2.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = sg2; g.fillRect(0, 0, w, h); }
    const t = document.createElement('canvas'); t.width = w; t.height = h; const q = t.getContext('2d'); if (!q || !q.save) return; const s = w / 96 * 0.96; q.save(); q.translate(w * 0.02, h * 0.02); q.scale(s, s);
    const r2 = (x, y, ww, hh, r) => { q.beginPath(); q.moveTo(x + r, y); q.lineTo(x + ww - r, y); q.arcTo(x + ww, y, x + ww, y + r, r); q.lineTo(x + ww, y + hh - r); q.arcTo(x + ww, y + hh, x + ww - r, y + hh, r); q.lineTo(x + r, y + hh); q.arcTo(x, y + hh, x, y + hh - r, r); q.lineTo(x, y + r); q.arcTo(x, y, x + r, y, r); q.closePath(); q.fill(); };
    if (i === 0) { q.translate(96, 0); q.scale(-1, 1); q.fillStyle = '#ff5418'; r2(29, 44, 38, 38, 10); for (let k = 0; k < 4; k++) r2(30 + k * 9.4, 13 + Math.abs(k - 1.4) * 4.5, 7.8, 40, 3.9); q.save(); q.translate(27, 62); q.rotate(-0.62); r2(-5, -18, 9.5, 27, 4.5); q.restore(); }
    else { q.fillStyle = '#eef3ff'; q.strokeStyle = '#eef3ff'; q.lineCap = 'round'; q.lineJoin = 'round'; q.beginPath(); q.arc(55, 15, 7.5, 0, TAU); q.fill(); q.lineWidth = 10; q.beginPath(); q.moveTo(51, 29); q.lineTo(46, 53); q.stroke(); q.lineWidth = 7; q.beginPath(); q.moveTo(47, 53); q.lineTo(60, 68); q.lineTo(63, 86); q.moveTo(46, 54); q.lineTo(38, 69); q.lineTo(26, 82); q.moveTo(51, 31); q.lineTo(65, 44); q.lineTo(75, 41); q.moveTo(50, 31); q.lineTo(37, 40); q.lineTo(31, 53); q.stroke(); }
    q.restore(); g.save(); g.globalAlpha = 0.1; g.filter = 'blur(9px)'; g.drawImage(t, 0, 0); g.restore(); q.globalCompositeOperation = 'destination-in'; q.fillStyle = '#fff'; const pt = w / 34; q.beginPath(); for (let yy = 0; yy < 37; yy++) for (let xx = 0; xx < 35; xx++) { const cx = (xx + (yy % 2 ? 0.5 : 0)) * pt, cy = yy * pt * 0.94; q.moveTo(cx + pt * 0.2, cy); q.arc(cx, cy, pt * 0.2, 0, TAU); } q.fill();
    q.globalCompositeOperation = 'source-atop'; for (let yy = 0; yy < 37; yy++) for (let xx = 0; xx < 35; xx++) { const hv = hsh(xx, yy, 40 + i); if (hv > 0.34) continue; const cx = (xx + (yy % 2 ? 0.5 : 0)) * pt, cy = yy * pt * 0.94; q.fillStyle = `rgba(0,0,0,${hv < 0.04 ? 0.85 : 0.12 + hv})`; q.beginPath(); q.arc(cx, cy, pt * 0.42, 0, TAU); q.fill(); }
    g.fillStyle = 'rgba(150,150,160,0.16)'; g.beginPath(); for (let yy = 0; yy < 37; yy++) for (let xx = 0; xx < 35; xx++) { const cx = (xx + (yy % 2 ? 0.5 : 0)) * pt, cy = yy * pt * 0.94, ux = cx / w * 96, uy = cy / h * 96; const on = i === 0 ? (Math.abs(ux - 50) < 9 && uy > 26 && uy < 56) || Math.hypot(ux - 54, uy - 15) < 8 || (uy >= 56 && uy < 88 && Math.abs(Math.abs(ux - 48) - (uy - 56) * 0.45) < 5) : (ux > 28 && ux < 68 && uy > 44 && uy < 84) || (ux > 30 && ux < 66 && uy > 14 && uy <= 44 && ((ux - 30) % 9.4) < 7.8); if (on) { g.moveTo(cx + pt * 0.27, cy); g.arc(cx, cy, pt * 0.27, 0, TAU); } } g.fill();      // the other symbol's diodes, unlit
    g.drawImage(t, 0, 0);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex: t, cells };
}

// ------------------------------------------------------------------------------------------------ materials
const WEAR = { wear: { value: null }, rust: { value: null }, paint: { value: null }, painth: { value: null } };
function loadWear(A) {
  const one = (rgb) => { const t = new THREE.DataTexture(new Uint8Array([rgb[0], rgb[1], rgb[2], 255]), 1, 1); t.needsUpdate = true; return t; };
  WEAR.wear.value = one([255, 115, 128]); WEAR.rust.value = one([120, 60, 30]); WEAR.paint.value = one([209, 209, 209]); WEAR.painth.value = one([81, 70, 0]);
  const ld = (file, slot, srgb) => new Promise((res) => { try { new THREE.TextureLoader().load(A + 'tex/' + file, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; slot.value = t; res(); }, undefined, () => { console.log('[streets] furniture: ' + file + ' not loaded'); res(); }); } catch (e) { res(); } });
  return Promise.all([ld('wear.jpg', WEAR.wear, false), ld('rust.jpg', WEAR.rust, true), ld('paint.jpg', WEAR.paint, true), ld('painth.jpg', WEAR.painth, false)]);
}
// the hero head: built once in Blender at high detail (items/signals/tools/bl/head.py): occlusion and the fixed sun's light baked per world yaw,
// paint, dirt and gloss composed from the bakes (compose.py). Drawn for the signal poles of the hero crossing only, inside 45 m.
const HHEAD = { ok: false };
async function loadHHead(A, HP) {
  try { const base = A + 'hhead/'; const QP = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams(''), R64 = QP.get('r64') === '1', HK = QP.get('hk') === '0' ? '' : QP.get('hk') === '2' ? 's' : R64 ? 'h' : 'k', HV = QP.get('hv') === '1',      /* r63: the dechipped paint, lens v2 and quarter relief are the kept look of ?fnext=1 (hk=0, hl=0, hm=0 give the r53 head back) */ HL = QP.get('hl') !== '0', HL3 = QP.get('hl') === '2', HM = QP.get('hm') !== '0'; HHEAD.HL = HL; HHEAD.HL3 = HL3; HHEAD.R64 = R64; const HG = QP.get('hg') === '1'; HHEAD.HG = HG; HHEAD.HB = QP.get('hb') !== '0'; const HXV = QP.get('hx') || '2', HX = HXV === '1' || HXV === '2', HXN = HXV === '2' ? 'hheady' : 'hheadx', CW = HX && HXV === '2' && QP.get('cw') !== '0', HN0 = QP.get('hn') === '0';
    const bin = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ' ' + r.status); const buf = await r.arrayBuffer(), n = new Uint32Array(buf, 0, 2), nv = n[0], ni = n[1]; let o = 8; const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, o, nv * 3), 3)); o += nv * 12; g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, o, nv * 3), 3)); o += nv * 12; g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, o, nv * 2), 2)); o += nv * 8;
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, o, ni), 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
    const one = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return Promise.resolve(t); };
    const texRaw = (f, srgb) => new Promise((res, rej) => new THREE.TextureLoader().load(base + f, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; res(t); }, undefined, () => rej(new Error(f))));
    const tex = texRaw;
    const [hn, geo, hang, c, orm, sA, sB, meta, pc, porm, pn] = await Promise.all([CW ? one(128, 128, 255) : tex('hhead_n' + HK + '.webp'), CW ? Promise.resolve(null) : bin('hhead.bin'), bin('hhang.bin'), CW ? one(96, 92, 80) : tex('hhead_c' + HK + '.webp', true), CW ? one(255, 190, 0) : tex('hhead_orm' + HK + '.webp'), CW ? one(255, 255, 255) : tex('hhead_sunA.webp'), CW ? one(255, 255, 255) : tex('hhead_sunB.webp'), fetch(base + 'hhead.json').then((r) => r.json()), tex('hpole_c.webp', true), tex('hpole_orm.webp'), tex('hpole_n.webp')]);
    /*CWTEX*/ for (const t of [pc, porm, pn]) t.wrapS = THREE.RepeatWrapping;
    const HHEAD_CWL = CW;      /* city rule: an unlit lens is dark glass with a trace of its colour, so only the lit one reads lit from the street */
    let xg = null; if (HX) { const [g2, c2, o2, n2, a2, b2] = await Promise.all([bin(HXN + '.bin'), tex(HXN + '_c.webp', true), tex(HXN + '_orm.webp'), tex(HXN + '_n.webp'), tex(HXN + '_sunA.webp'), tex(HXN + '_sunB.webp')]); xg = { g2, c2, o2, n2, a2, b2 }; if (CW) { xg.meta = await fetch(base + HXN + '.json').then((r) => r.json()); xg.low = await bin(HXN + 'l.bin'); } }      // r67: the new head asset
    const pole = new THREE.CylinderGeometry(0.098, 0.14, 5.98, 48, 12, true); pole.translate(0, 0.97 + 2.99, 0);
    // the unlit glass of the three lenses (the lit lamp is drawn over it by the lamp meshes)
    const ls = []; for (let k = -1; k <= 1; k++) { const g = domeGeo(0.1475, 24, 4); g.translate(0.004, k * 0.345, 0); const lc = HL3 ? (k === 1 ? [0.30, 0.03, 0.026] : k === 0 ? [0.36, 0.16, 0.014] : [0.014, 0.21, 0.125]) : HHEAD_CWL ? (k === 1 ? [0.060, 0.016, 0.015] : k === 0 ? [0.070, 0.042, 0.014] : [0.014, 0.046, 0.034]) : HL ? (k === 1 ? [0.20, 0.022, 0.02] : k === 0 ? [0.26, 0.115, 0.012] : [0.012, 0.15, 0.09]) : k === 1 ? [0.36, 0.06, 0.05] : k === 0 ? [0.4, 0.22, 0.03] : [0.04, 0.27, 0.18], Pg = g.attributes.position, col = new Float32Array(Pg.count * 3);
      for (let q = 0; q < Pg.count; q++) { const f = 0.3 + 0.7 * Math.min(1, Math.max(0, 0.5 - (Pg.getY(q) - k * 0.345) / 0.295)); col[q * 3] = lc[0] * f; col[q * 3 + 1] = lc[1] * f; col[q * 3 + 2] = lc[2] * f; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); ls.push(g); }
    const lens = mergeGeometries(ls); lens.computeBoundingSphere(); lens.computeBoundingBox();
    let visor = null; if (HV) {      // r62: thin sheet-metal cutaway visors in place of the baked thick ones
      { const ix = geo.index.array, Pp = geo.attributes.position, keep = []; for (let t = 0; t < ix.length; t += 3) { let fr = 0; for (let q = 0; q < 3; q++) { const v = ix[t + q], x = Pp.getX(v), yy = Pp.getY(v), r = Math.hypot(yy - Math.round(yy / 0.345) * 0.345, Pp.getZ(v)); if (x > 0.03 && r > 0.13 && r < 0.17) fr++; } if (fr < 3) keep.push(ix[t], ix[t + 1], ix[t + 2]); } geo.setIndex(keep); }
      const pos = [], nor = [], col = [], uv = [], idx = [], NA = 48, NL = 7, TH = 0.0022, YC = [0.50, 0.215, 0.012], IC = [0.036, 0.035, 0.033];
      const len = (phi) => { const a = Math.abs(phi) * 180 / PI; return a < 96 ? 0.245 : 0.245 - (0.245 - 0.028) * Math.pow((a - 96) / 84, 0.75); };      // phi 0 = top; the lower part is cut away towards the door
      for (let k = -1; k <= 1; k++) { const cy = k * 0.345; for (const inner of [0, 1]) { const b0 = pos.length / 3; for (let i = 0; i <= NA; i++) { const phi = -PI + TAU * i / NA, L = len(phi), cs = Math.cos(phi), sn = Math.sin(phi); for (let j = 0; j <= NL; j++) { const x = 0.018 + (L - 0.018) * j / NL, R = 0.1505 + 0.007 * x / 0.245 - (inner ? TH : 0), dn = 0.7 + 0.3 * (0.5 + 0.5 * cs), dust = inner ? 1 + 0.9 * Math.max(0, -cs) * (x / 0.245) : 1;
              pos.push(x, cy + R * cs, R * sn); nor.push(0, inner ? -cs : cs, inner ? -sn : sn); const c0 = inner ? IC : YC, f = inner ? dust : dn * (0.93 + 0.07 * Math.sin(i * 1.7 + k)); col.push(c0[0] * f, c0[1] * f, c0[2] * f); uv.push(i / NA, j / NL); } }
          for (let i = 0; i < NA; i++) for (let j = 0; j < NL; j++) { const a = b0 + i * (NL + 1) + j, b = a + NL + 1; if (inner) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1); } }
        { const b0 = pos.length / 3; for (let i = 0; i <= NA; i++) { const phi = -PI + TAU * i / NA, L = len(phi), cs = Math.cos(phi), sn = Math.sin(phi), R = 0.1505 + 0.007 * L / 0.245; for (const d of [0, TH]) { pos.push(L, cy + (R - d) * cs, (R - d) * sn); nor.push(1, 0, 0); col.push(YC[0] * 0.8, YC[1] * 0.8, YC[2] * 0.8); uv.push(i / NA, 1); } }      // the cut edge: paint
          for (let i = 0; i < NA; i++) { const a = b0 + i * 2; idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); } } }
      visor = new THREE.BufferGeometry(); visor.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); visor.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); visor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); visor.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); visor.setIndex(idx); visor.computeBoundingSphere(); visor.computeBoundingBox(); }
    const lcv = document.createElement('canvas'); lcv.width = lcv.height = 256; { const g = lcv.getContext('2d'); g.fillStyle = HL ? '#a8a8a8' : '#6a6a6a'; g.fillRect(0, 0, 256, 256); g.fillStyle = HL ? '#c6c6c6' : '#ffffff'; for (let j = 0, y = 6; y < 256; y += 13, j++) for (let x = j % 2 ? 13.5 : 6; x < 256; x += 15) { if (Math.hypot(x - 128, y - 128) > 122) continue; g.beginPath(); g.arc(x, y, 4.2, 0, 6.2832); g.fill(); } }
    const lmap = new THREE.CanvasTexture(lcv); lmap.colorSpace = THREE.SRGBColorSpace; lmap.anisotropy = 4;
    const band = (m, key, frag, uA = sA, uB = sB, vex = null) => { m.onBeforeCompile = (sh) => { sh.uniforms.tSunA = { value: uA }; sh.uniforms.tSunB = { value: uB };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec2 aBand; attribute float aSun; varying float vSunCh;')
          .replace('#include <project_vertex>', '#include <project_vertex>\n vSunCh = aSun; { vec3 hO = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float hBd = distance(cameraPosition.xz, hO.xz); if (aBand.y > 0.5 && (hBd >= aBand.y || hBd < aBand.x)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }');
        if (frag) sh.fragmentShader = frag(sh.fragmentShader); if (vex) sh.vertexShader = vex(sh.vertexShader); }; m.customProgramCacheKey = () => key; return m; };
    const LFB = THREE.ShaderChunk.lights_fragment_begin, LK = 'getDirectionalLightInfo( directionalLight, directLight );'; if (!LFB.includes(LK)) throw new Error('light chunk changed');
    const sunFrag = (fs) => fs
      .replace('#include <common>', '#include <common>\n uniform sampler2D tSunA; uniform sampler2D tSunB; varying float vSunCh; float hVis;')
      .replace('#include <lights_fragment_begin>', '{ vec3 hA = texture2D(tSunA, vAoMapUv).rgb, hB = texture2D(tSunB, vAoMapUv).rgb; hVis = vSunCh < 0.5 ? hA.r : vSunCh < 1.5 ? hA.g : vSunCh < 2.5 ? hA.b : vSunCh < 3.5 ? hB.r : vSunCh < 4.5 ? hB.g : vSunCh < 5.5 ? hB.b : 1.0; }\n' + LFB.replace(LK, LK + ' directLight.color *= hVis;'));
    const mat = band(new THREE.MeshStandardMaterial({ map: c, aoMap: orm, roughnessMap: orm, metalnessMap: orm, normalMap: hn, normalScale: new THREE.Vector2(HN0 ? 0 : HM ? 0.3 : 1, HN0 ? 0 : HM ? 0.3 : 1), roughness: 1, metalness: 1, side: THREE.DoubleSide }), HM ? 'sthhead3' + (R64 ? 'e' : '') : 'sthhead1', HM ? (fs) => sunFrag(fs).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = max(roughnessFactor, 0.66);').replace('#include <lights_fragment_end>', R64 ? '#include <lights_fragment_end>\n irradiance *= 0.5; iblIrradiance *= 0.5; radiance *= 0.5;' : '#include <lights_fragment_end>').replace('#include <map_fragment>', '#include <map_fragment>\n { float hL = dot(diffuseColor.rgb, vec3(0.3333)); float hDk = 1.0 - smoothstep(0.02, 0.07, hL); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.162, 0.15) * (0.75 + 8.0 * hL), hDk * 0.9); }') : sunFrag);      // r48: relief again, now only cast lettering and chips      // r45: the relief at full strength drew as "a noisy, sparkly orange-peel"
    const lmat = HL ? band(new THREE.MeshStandardMaterial({ map: lmap, vertexColors: true, roughness: 0.16, metalness: 0, envMapIntensity: 1.0 }), 'sthlens2' + (R64 ? 'e' : ''), (fs) => fs.replace('#include <lights_fragment_begin>', LFB.replace(LK, LK + ' directLight.color *= 0.10;'))
        .replace('#include <lights_fragment_end>', '{ float hLum = max(vColor.r, max(vColor.g, vColor.b)) * 5.0; float hOpen = smoothstep(0.3, 0.9, hLum); radiance *= 0.05 + ' + (R64 ? '1.5' : '0.5') + ' * hOpen * hOpen; iblIrradiance *= 1.6; }\n#include <lights_fragment_end>'))
      : band(new THREE.MeshStandardMaterial({ map: lmap, vertexColors: true, roughness: 0.1, metalness: 0, envMapIntensity: 0.7 }), 'sthlens1', (fs) => fs.replace('#include <lights_fragment_begin>', LFB.replace(LK, LK + ' directLight.color *= 0.12;')));
    const pmat = band(new THREE.MeshStandardMaterial({ map: pc, roughnessMap: porm, metalnessMap: porm, normalMap: pn, roughness: 1, metalness: 1 }), 'sthpole1');
    const vmat = visor ? band(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }), 'sthvis1', null) : null;

    if (HG) {      // r65: lining, recessed lens well, reflector bowl, glass cap, lit cap (head frame: x = lens axis, lens centres at y = k * 0.345)
      const VL = [[0, 0, 0.16, 0.195, 0.199, 0.204, 0.212, 0.218, 0.224, 0.23, 0.236, 0.242, 0.249, 0.253, 0.257, 0.259, 0.261, 0.261, 0.261, 0.261, 0.259, 0.256, 0.253, 0.248, 0.243, 0.238, 0.232, 0.226, 0.22, 0.214, 0.206, 0.201, 0.196, 0.193, 0, 0],
        [0, 0, 0.153, 0.186, 0.19, 0.194, 0.2, 0.205, 0.214, 0.22, 0.225, 0.231, 0.235, 0.24, 0.243, 0.247, 0.249, 0.25, 0.249, 0.249, 0.247, 0.244, 0.241, 0.237, 0.232, 0.227, 0.221, 0.216, 0.21, 0.201, 0.196, 0.191, 0.187, 0.184, 0, 0],
        [0, 0, 0.205, 0.208, 0.212, 0.216, 0.224, 0.229, 0.234, 0.239, 0.244, 0.249, 0.253, 0.257, 0.26, 0.262, 0.264, 0.264, 0.264, 0.264, 0.263, 0.26, 0.256, 0.252, 0.248, 0.243, 0.238, 0.233, 0.228, 0.223, 0.215, 0.211, 0.208, 0.205, 0, 0]];      // the baked visor's length every 10 degrees round the lens (0 = top), measured from hhead.bin
      const Lat = (k, phi) => { const T = VL[k + 1], f = (phi * 180 / PI + 175) / 10, i0 = Math.floor(f), a = T[((i0 % 36) + 36) % 36], b = T[(((i0 + 1) % 36) + 36) % 36]; return a && b ? a + (b - a) * (f - i0) : 0; };
      const hh = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
      const mk = () => ({ pos: [], nor: [], col: [], mr: [], uv: [], idx: [] }), V = (G, x, y, z, nx, ny, nz, c, m, r) => { const l = Math.hypot(nx, ny, nz) || 1; G.pos.push(x, y, z); G.nor.push(nx / l, ny / l, nz / l); G.col.push(c[0], c[1], c[2]); G.mr.push(m, r); if (G.plain) G.uv.push(0.012, 0.012); else G.uv.push(0.5 + z / 0.277, 0.5 + (y - Math.round(y / 0.345) * 0.345) / 0.277); return G.pos.length / 3 - 1; };
      const fin = (G) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(G.col, 3)); g.setAttribute('aMR', new THREE.Float32BufferAttribute(G.mr, 2)); g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.setIndex(G.idx); g.computeBoundingSphere(); g.computeBoundingBox(); return g; };
      const RL = 0.1385, TINT = { '1': [0.36, 0.04, 0.036], '0': [0.47, 0.21, 0.022], '-1': [0.022, 0.27, 0.16] }, PK = 1 / 0.39, W = mk(), GL = mk(), NA = 72, NL = 10, NW = 48, NR = 12;
      const capX = (r, x0) => x0 - 0.009 * (r / RL) * (r / RL);      // the convex glass: apex at x0, rim 9 mm behind it
      for (let k = -1; k <= 1; k++) { const cy = k * 0.345, tint = TINT[k];
        { const b0 = W.pos.length / 3; W.plain = true;      // the visor lining: faded black paint under dust, lighter towards the mouth, streaked along the tube
          for (let i = 0; i <= NA; i++) { const phi = -PI + TAU * i / NA, Lp = Math.max(Lat(k, phi), 0.03), cs = Math.cos(phi), sn = Math.sin(phi), st = 0.9 + 0.2 * hh(i % NA, k + 2);
            for (let j = 0; j <= NL; j++) { const t = j / NL, x = 0.012 + (Lp - 0.0135) * t, r = 0.1545 - 0.0445 * x - 0.0015, ao = 0.34 + 0.66 * Math.pow(t, 1.2), bl = 0.78 + 0.3 * Math.sin(phi * 2.3 + k * 1.9 + 4.0 * t) * Math.sin(phi * 1.1 - 2.6 * t + k) + 0.14 * Math.sin(phi * 5.0 + 9.0 * t), f = PK * ao * st * bl * (0.93 + 0.14 * hh(i * 13 + j, k + 7)) * (1 + 0.25 * t * Math.max(0, -cs));
              V(W, x, cy + r * cs, r * sn, 0, -cs, -sn, [0.15 * f, 0.14 * f, 0.125 * f], 0, 0.92); } }
          for (let i = 0; i < NA; i++) { if (!(Lat(k, -PI + TAU * i / NA) > 0.03 && Lat(k, -PI + TAU * (i + 1) / NA) > 0.03)) continue; for (let j = 0; j < NL; j++) { const a = b0 + i * (NL + 1) + j, b = a + NL + 1; W.idx.push(a, a + 1, b, b, a + 1, b + 1); } } }
        { const b0 = W.pos.length / 3;      // the gasket wall of the recess
          for (let i = 0; i <= NW; i++) { const phi = TAU * i / NW, cs = Math.cos(phi), sn = Math.sin(phi); V(W, -0.012, cy + RL * cs, RL * sn, 0, -cs, -sn, [0.012 * PK, 0.012 * PK, 0.013 * PK], 0, 0.8); V(W, 0.0045, cy + RL * cs, RL * sn, 0, -cs, -sn, [0.03 * PK, 0.03 * PK, 0.032 * PK], 0, 0.8); }
          for (let i = 0; i < NW; i++) { const a = b0 + i * 2, b = a + 2; W.idx.push(a, a + 1, b, b, a + 1, b + 1); } }
        { const b0 = W.pos.length / 3; W.plain = false;      // r66: a flat LED board (the kept dot map) behind the glass; was a ridged reflector bowl behind the glass, ridged like a pressed fresnel, in the lens's own tint (light passes the glass twice)
          for (let m = 0; m <= NR; m++) { const r = RL * m / NR, x = -0.022 + 0.004 * (r / RL) * (r / RL), sl = -0.008 * r / (RL * RL), f = 1.0 - 0.45 * Math.pow(r / RL, 3.0);
            for (let i = 0; i <= NW; i++) { const phi = TAU * i / NW, cs = Math.cos(phi), sn = Math.sin(phi); V(W, x, cy + r * cs, r * sn, 1, sl * cs, sl * sn, [tint[0] * f, tint[1] * f, tint[2] * f], 0, 0.55); } }
          for (let m = 0; m < NR; m++) for (let i = 0; i < NW; i++) { const a = b0 + m * (NW + 1) + i, b = a + NW + 1, c = a + 1, d = b + 1; W.idx.push(a, b, c, c, b, d); } }
        { const b0 = GL.pos.length / 3, NG = 8;      // the glass cap: only its reflection and a thin dust film are drawn (additive)
          for (let m = 0; m <= NG; m++) { const r = RL * m / NG, x = capX(r, 0.003), sl = 0.018 * r / RL / RL * RL; for (let i = 0; i <= NW; i++) { const phi = TAU * i / NW, cs = Math.cos(phi), sn = Math.sin(phi); V(GL, x, cy + r * cs, r * sn, 1, sl * cs / RL, sl * sn / RL, [tint[0] * 0.12 + 0.004, tint[1] * 0.12 + 0.004, tint[2] * 0.12 + 0.004], 0, 0.2); } }
          for (let m = 0; m < NG; m++) for (let i = 0; i < NW; i++) { const a = b0 + m * (NW + 1) + i, b = a + NW + 1, c = a + 1, d = b + 1; GL.idx.push(a, b, c, c, b, d); } } }
      const hcap = {}, HOT = { r: [[2.7, 0.085, 0.06], [1.25, 0.03, 0.028]], y: [[3.2, 1.7, 0.25], [1.3, 0.5, 0.02]], g: [[0.35, 3.0, 1.5], [0.02, 1.1, 0.45]] };      // the lit cap sits 1.5 mm proud of the glass; the hot centre is in its vertex colours
      for (const kc of ['r', 'y', 'g']) { const G = mk(), NG = 8, RC = 0.134, [c0, c1] = HOT[kc];
        for (let m = 0; m <= NG; m++) { const r = RC * m / NG, x = capX(r, 0.0045), sl = 0.018 * r / RL, t = Math.pow(m / NG, 1.5), w = Math.exp(-3.2 * t * t) * 0.85 + 0.15 * (1 - t); for (let i = 0; i <= NW; i++) { const phi = TAU * i / NW, cs = Math.cos(phi), sn = Math.sin(phi); V(G, x, r * cs, r * sn, 1, sl * cs, sl * sn, [c1[0] + (c0[0] - c1[0]) * w, c1[1] + (c0[1] - c1[1]) * w, c1[2] + (c0[2] - c1[2]) * w], 0, 1); } }
        for (let m = 0; m < NG; m++) for (let i = 0; i < NW; i++) { const a = m * (NW + 1) + i, b = a + NW + 1, c = a + 1, d = b + 1; G.idx.push(a, b, c, c, b, d); }
        hcap[kc] = fin(G); }
      const OPEN = `float hgOpen(vec3 p, vec3 d) {      // 1 where a ray from p along d leaves the visor through its mouth or its lower cut
          float cy = floor(p.y / 0.345 + 0.5) * 0.345; vec2 q = vec2(p.y - cy, p.z); vec2 e = d.yz; float a = dot(e, e); if (a < 1e-5) return step(0.0, d.x);
          float R = max(length(q) + 0.002, 0.149); float b = dot(q, e), c = dot(q, q) - R * R; float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
          float xe = p.x + t * d.x; vec2 qe = q + t * e; float ph = atan(qe.y, qe.x);
          float Lv = abs(ph) > 2.88 ? 0.0 : 0.185 + 0.065 * (0.5 + 0.5 * cos(ph)) + (cy > 0.1 ? 0.014 : cy < -0.1 ? 0.011 : 0.0);
          return smoothstep(-0.004, 0.004, xe - Lv); }`;
      const hgm = (m, key) => { m.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n attribute vec2 aBand; attribute vec2 aMR; varying vec3 vHL; varying vec3 vHN; varying vec3 vHW; varying mat3 vHM; varying vec2 vMR;')
            .replace('#include <project_vertex>', '#include <project_vertex>\n { mat4 hm = modelMatrix * instanceMatrix; vHL = position; vHN = normal; vHM = mat3(hm); vHW = (hm * vec4(position, 1.0)).xyz; vMR = aMR; float hBd = distance(cameraPosition.xz, hm[3].xz); if (aBand.y > 0.5 && (hBd >= aBand.y || hBd < aBand.x)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n varying vec3 vHL; varying vec3 vHN; varying vec3 vHW; varying mat3 vHM; varying vec2 vMR; float hgSun;\n' + OPEN)
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = vMR.y;').replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = vMR.x;')
            .replace('#include <lights_fragment_begin>', '{ vec3 hsW = directionalLights[0].direction * mat3(viewMatrix); hgSun = hgOpen(vHL, normalize(hsW * vHM)); }\n' + LFB.replace(LK, LK + ' directLight.color *= hgSun;'))
            .replace('#include <lights_fragment_end>', '{ vec3 hvL = normalize((cameraPosition - vHW) * vHM); vec3 hrL = reflect(-hvL, normalize(vHN)); radiance *= mix(0.05, 1.0, hgOpen(vHL, hrL)); }\n#include <lights_fragment_end>'); };
        m.customProgramCacheKey = () => key; m.userData.hgNoRecv = true; return m; };
      HHEAD.well = fin(W); HHEAD.glass = fin(GL); HHEAD.hcap = hcap;
      HHEAD.wmat = hgm(new THREE.MeshStandardMaterial({ map: lmap, vertexColors: true, roughness: 1, metalness: 0 }), 'sthwell2');
      HHEAD.glmat = hgm(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 'sthglass1'); }
    Object.assign(HHEAD, { ok: true, geo, hang, lens, mat, lmat, pole, pmat, visor, vmat, yaws: meta.yaws });
    if (xg) { HHEAD.hmat = mat; HHEAD.geo = xg.g2; if (xg.meta) { HHEAD.yaws = xg.meta.yaws; HHEAD.low = xg.low; HHEAD.CW = true; } HHEAD.mat = band(new THREE.MeshStandardMaterial({ map: xg.c2, aoMap: xg.o2, roughnessMap: xg.o2, metalnessMap: xg.o2, normalMap: xg.n2, roughness: 1, metalness: 1, side: THREE.DoubleSide }), 'sthheadx', sunFrag, xg.a2, xg.b2); }
    if (HP) try { const [pg2, pc2, pj2, psA, psB] = await Promise.all([bin('hheadp.bin'), tex('hheadp_c.webp', true), fetch(base + 'hheadp.json').then((r) => r.json()), tex('hheadp_sunA.webp'), tex('hheadp_sunB.webp')]); HHEAD.pmeta = pj2;      // r55: a head textured from a photograph; its light is the photograph's, so every texel is lit as one sun-facing surface
      HHEAD.pgeo = pg2; HHEAD.pmatP = band(new THREE.MeshStandardMaterial({ map: pc2, roughness: HP.r, metalness: 0, side: THREE.DoubleSide, color: new THREE.Color(HP.k, HP.k, HP.k) }), 'sthheadp2', (fs) => sunFrag(fs).split('vAoMapUv').join('vMapUv'), psA, psB); } catch (e) { console.warn('[streets] photo head not loaded', e); }
    try { const [pg, qc, qo, qn, qA, qB, pm] = await Promise.all([bin('hped.bin'), tex('hped_c.webp', true), tex('hped_orm.webp'), tex('hped_n.webp'), tex('hped_sunA.webp'), tex('hped_sunB.webp'), fetch(base + 'hped.json').then((r) => r.json())]);
      HHEAD.ped = { geo: pg, yaws: pm.yaws, mat: band(new THREE.MeshStandardMaterial({ map: qc, aoMap: qo, roughnessMap: qo, metalnessMap: qo, normalMap: qn, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 1, metalness: 1 }), 'sthped1', sunFrag, qA, qB) }; } catch (e) { console.log('[streets] furniture: hero pedestrian head not loaded: ' + (e && e.message)); }
    try { const [hw, face, qc, qo, qn, qA, qB, pm] = await Promise.all([bin('hsign.bin'), bin('hsignf.bin'), tex('hsign_c.webp', true), tex('hsign_orm.webp'), tex('hsign_n.webp'), tex('hsign_sunA.webp'), tex('hsign_sunB.webp'), fetch(base + 'hsign.json').then((r) => r.json())]);
      HHEAD.sign = { hw, face, yaws: pm.yaws, mat: band(new THREE.MeshStandardMaterial({ map: qc, aoMap: qo, roughnessMap: qo, metalnessMap: qo, normalMap: qn, roughness: 1, metalness: 1 }), 'sthsign1', sunFrag, qA, qB),
        fmat: band(new THREE.MeshStandardMaterial({ aoMap: qo, roughnessMap: qo, roughness: 1, metalness: 0 }), 'sthsignf1', (fs) => sunFrag(fs).replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= texture2D(aoMap, vAoMapUv).b;'), qA, qB,
          (vs) => vs.replace('#include <common>', '#include <common>\n attribute vec2 uvl; attribute vec2 aCell;').replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv = uvl + aCell;')) }; } catch (e) { console.log('[streets] furniture: hero sign not loaded: ' + (e && e.message)); }
  } catch (e) { console.log('[streets] furniture: hero head not loaded: ' + (e && e.message)); }
}
const FRAG_COMMON = /* glsl */`
  varying vec3 vWPos; varying vec4 vFw; varying vec3 vWN; uniform sampler2D tWear; uniform sampler2D tRust; uniform sampler2D tPaint; uniform sampler2D tPaintH; uniform vec3 uSunDir; float fBump; float fPole; float fPoleR; float fArm; float fGloss; float fEnam; float fVis; float fShade; float fHsh; varying vec4 vHL; varying vec3 vSunL;
  uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform float uShadowFar; uniform vec3 uShadowCenter;
  vec3 bakeV; vec3 bakeN; float fRust; float fBase; vec3 fEmit;
  float fH(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float fN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(fH(i), fH(i+vec2(1,0)), f.x), mix(fH(i+vec2(0,1)), fH(i+vec2(1,1)), f.x), f.y); }`;
// mode 'f': the modelled pieces (vertex colour, atlas, per-vertex wear). mode 's': a scanned prop (own textures; base dirt and bake only).
function patch(m, shared, mode, extra = '') {
  const f = mode === 'f';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tLight: shared.tLight, uHalf: shared.uHalf, uSunColor: shared.uSunColor, uShadowFar: shared.uShadowFar, uShadowCenter: shared.uShadowCenter, tWear: WEAR.wear, tRust: WEAR.rust, tPaint: WEAR.paint, tPaintH: WEAR.painth, uSunDir: shared.uSunDir });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec4 vFw; varying vec3 vWN; attribute vec2 aBand; float fCull; ${f ? 'attribute vec4 aW; attribute vec3 aTint; attribute vec2 aCell; attribute vec4 aHL; varying vec4 vHL; varying vec3 vSunL; uniform vec3 uSunDir;' : ''}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        ${f ? `#ifdef USE_MAP
          vMapUv += aCell * aW.z;
        #endif` : ''}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        ${f ? 'vColor.rgb *= mix(vec3(1.0), aTint, aW.w);' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 fP = vec4(transformed, 1.0); vec4 fO = vec4(0.0, 0.0, 0.0, 1.0); vec3 fN = normal;
        #ifdef USE_INSTANCING
          fP = instanceMatrix * fP; fO = instanceMatrix * fO; fN = mat3(instanceMatrix) * fN;
        #endif
        vWN = normalize(mat3(modelMatrix) * fN);
        fP = modelMatrix * fP; fO = modelMatrix * fO; fCull = 0.0;
        ${f ? `{ float hyaw = aHL.w > 50.0 ? aHL.w - 100.0 : aHL.w; vHL = vec4(aHL.xyz, aHL.x > 500.0 ? -1.0 : (aHL.w > 50.0 ? 0.32 : 0.27)); vec3 sP = uSunDir;
        #ifdef USE_INSTANCING
          sP = normalize(transpose(mat3(instanceMatrix)) * sP);
        #endif
          float hc = cos(hyaw), hs = sin(hyaw); vSunL = vec3(hc * sP.x - hs * sP.z, sP.y, hs * sP.x + hc * sP.z); }` : ''}
        #ifdef USE_INSTANCING
          if (aBand.y > 0.5) { float fBd = distance(cameraPosition.xz, fO.xz); if (fBd >= aBand.y || fBd < aBand.x) fCull = 1.0; }      // each instance is drawn only inside its own distance band (a tile is drawn whole otherwise)
        #endif
        vWPos = fP.xyz; vFw = vec4(${f ? 'aW.x, aW.y' : '0.0, 0.0'}, fP.y - fO.y, 0.0); }`);
    sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n        if (fCull > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
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
          fEnam = step(0.03, vFw.y) * step(vFw.y, 0.07);                                    // glossy enamel: signal housings, visors, lens glass
          fPole = step(0.2, vFw.y) * step(vFw.y, 0.55); fBump = 0.0; fPoleR = 0.0; fArm = step(0.43, vFw.y) * step(vFw.y, 0.44); float fSheet = step(0.09, vFw.y) * step(vFw.y, 0.11);       // reflective sign sheeting
          // the sun shadow of a signal head's own visors (the sun shadow map is far too coarse for this): the ray to the sun against the three visor skins
          fHsh = 0.0;
          if (vHL.w > 0.0) { vec3 hP = vHL.xyz, hD = normalize(vSunL); float ha = dot(hD.yz, hD.yz);
            if (ha > 1e-4) for (int hk = -1; hk <= 1; hk++) { vec2 hq = vec2(hP.y - float(hk) * 0.345, hP.z); if (hP.x > 0.0 && abs(length(hq) - 0.16) < 0.016) continue; float hb = dot(hq, hD.yz), hc2 = dot(hq, hq) - 0.0256, hd = hb * hb - ha * hc2;
              if (hd > 0.0) { float hs2 = sqrt(hd); for (int hj = 0; hj < 2; hj++) { float ht = (-hb + (hj == 0 ? -hs2 : hs2)) / ha; if (ht > 0.012) { float hX = hP.x + ht * hD.x, htt = hX / vHL.w; vec2 hh = hq + ht * hD.yz;
                float hlen = 0.8 + 0.2 * clamp((hh.x / 0.15 + 0.75) / 1.5, 0.0, 1.0); if (hX > 0.004 && htt < hlen && abs(atan(hh.y, hh.x)) < 2.70 * (1.0 - 0.07 * htt / hlen)) fHsh = 1.0; } } } } }
          float fFace = gl_FrontFacing ? 1.0 : -1.0;
          diffuseColor.rgb *= mix(mix(0.74 + 0.2 * n2 + 0.16 * n1, 1.08 + 0.05 * n2, fEnam), 1.08 + 0.04 * n1, fSheet) * (0.86 + 0.14 * max(fEnam, fSheet) + 0.28 * n3 * step(0.15, vFw.y) * (1.0 - 0.8 * fArm));
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 1.06, 0.22 * n2 * (1.0 - fEnam) * (1.0 - fSheet));          // sun fade
          // scanned wear, projected along the two horizontal axes and blended by the surface normal
          vec3 an = abs(vWN); float wz = an.z / max(1e-3, an.x + an.z); vec2 ua = vec2(wp.x, wp.y) * 0.85 + vec2(wp.z * 0.37, 0.0), ub = vec2(wp.z, wp.y) * 0.85 + vec2(wp.x * 0.37, 0.0);
          // the six scan reads only within a near band of the camera (cost): beyond it the neutral values
          vec3 wr = vec3(1.0, 0.45, 0.5), wr2 = wr, rs = vec3(0.2, 0.09, 0.05);
          float fNear = 1.0 - smoothstep(38.0, 52.0, distance(cameraPosition, wp));
          vec2 dax = dFdx(ua), day = dFdy(ua), dbx = dFdx(ub), dby = dFdy(ub);
          if (fNear > 0.0) {
            vec3 w1 = mix(textureGrad(tWear, ub, dbx, dby).rgb, textureGrad(tWear, ua, dax, day).rgb, wz), w2 = mix(textureGrad(tWear, ub * 3.7, dbx * 3.7, dby * 3.7).rgb, textureGrad(tWear, ua * 3.7, dax * 3.7, day * 3.7).rgb, wz);
            rs = mix(textureGrad(tRust, ub * 2.0, dbx * 2.0, dby * 2.0).rgb, textureGrad(tRust, ua * 2.0, dax * 2.0, day * 2.0).rgb, wz);
            wr = mix(wr, w1, fNear); wr2 = mix(wr2, w2, fNear);
            if (fEnam > 0.0 && vFw.y > 0.045) {      // signal enamel: the same scan, small and sparse: chips down to grey primer, a rust speck here and there, slow fading
              vec2 ea = ua * 1.9 + 0.23, eb = ub * 1.9 + 0.61; vec3 ec = mix(texture2D(tPaint, eb).rgb, texture2D(tPaint, ea).rgb, wz), el = mix(texture2D(tPaint, eb * 0.09).rgb, texture2D(tPaint, ea * 0.09).rgb, wz);
              float eLum = dot(ec, vec3(0.333)), eChip = 0.45 * (1.0 - smoothstep(0.3, 0.42, eLum)) * fNear * smoothstep(0.45, 0.7, n2), eRust = smoothstep(0.06, 0.16, ec.r - ec.b) * fNear;
              diffuseColor.rgb *= mix(1.0, 0.86 + 0.2 * dot(el, vec3(0.333)) / 0.62, fNear);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.35, 0.31), 0.72 * eChip * (1.0 - eRust)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.13, 0.05), 0.7 * eRust); fPoleR += 0.3 * max(eChip, eRust); }
            if (fPole > 0.0) {       // painted steel of poles, arms and brackets: a scan (colour, relief, roughness), wrapped round by the same two projections
              vec2 pa = ua * 0.62 + 0.37, pb2 = ub * 0.62 + 0.11; float pUp = step(abs(vWN.y), 0.35);
              float pw = wz; if (pUp > 0.5) { pa = vec2(abs(atan(vWN.z, vWN.x)) * 0.075, wp.y * 0.53) + 0.37; pb2 = pa; }
              vec3 pc = mix(textureGrad(tPaint, pb2, dbx * 0.62, dby * 0.62).rgb, textureGrad(tPaint, pa, dax * 0.62, day * 0.62).rgb, pw); vec2 ph = mix(textureGrad(tPaintH, pb2, dbx * 0.62, dby * 0.62).rg, textureGrad(tPaintH, pa, dax * 0.62, day * 0.62).rg, pw);
              vec3 pl = mix(texture2D(tPaint, pb2 * 0.13).rgb, texture2D(tPaint, pa * 0.13).rgb, wz);          // the same scan very large: slow drifts of tone along the pole
              vec3 pcc = pc / mix(0.6, 0.82, pUp); { float pl2 = dot(pcc, vec3(0.333)); pcc = mix(vec3(0.84), pcc, 0.35 + 0.65 * smoothstep(0.7, 0.84, pl2)); }
              diffuseColor.rgb *= mix(vec3(1.0), pcc * (0.55 + 0.5 * dot(pl, vec3(0.333)) / 0.82) * (0.9 + 0.2 * n1), fNear * fPole);      // arms and brackets (not upright) keep the zinc's own brightness
              fBump = clamp(ph.x - 0.316, -0.12, 0.1) * fNear * fPole; fPoleR = (ph.y - 0.27) * fNear * fPole; }
          }
          float prone = clamp(vFw.x * 1.3, 0.0, 1.0);                                       // how readily this surface chips and rusts
          fRust = (1.0 - smoothstep(0.05 + 0.5 * prone, 0.3 + 0.55 * prone, wr.r * 0.75 + wr2.r * 0.25)) * step(0.01, vFw.x) * (1.0 - 0.9 * fEnam) * (1.0 - 0.45 * step(0.40, vFw.y) * step(vFw.y, 0.44) - 0.5 * fArm);
          diffuseColor.rgb *= mix(0.9 + 0.2 * wr.b, 0.97 + 0.06 * wr.b, fEnam);                                            // tone drift inside the paint or zinc
          { vec3 rc = rs * rs * (0.5 + 0.5 * n3); rc = mix(vec3(dot(rc, vec3(0.3, 0.5, 0.2))), rc, 0.55) * 0.8; diffuseColor.rgb = mix(diffuseColor.rgb, rc, fRust * 0.85); }
          fGloss = ((wr.g - 0.45) * 0.5 + (wr2.g - 0.45) * 0.3) * (1.0 - 0.6 * fEnam) * (1.0 - fSheet);
          float chip = step(0.9, fN(wp.xy * 67.0 + wp.z * 43.0)) * step(0.5, n2) * (1.0 - vFw.y) * step(0.02, vFw.x) * (1.0 - fEnam);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.19, 0.185), chip * 0.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.9 + vec3(0.07, 0.065, 0.055), 0.5 * fEnam * step(0.045, vFw.y) * smoothstep(0.55, 0.95, vWN.y));      // dust on what faces the sky
          float fZinc = step(0.40, vFw.y) * step(vFw.y, 0.44) * step(abs(vWN.y), 0.5);                         // upright painted steel: shafts of signal poles and lamp posts
          float fCoat = fZinc * (1.0 - smoothstep(2.38, 2.46, vFw.z + 0.05 * (n2 - 0.5))) * step(0.95, vFw.z);                 // the grey anti-poster coat low on the shaft
          diffuseColor.rgb *= 1.0 - 0.32 * fCoat; fPoleR += 0.2 * fCoat;
          { float sa = atan(vWN.z, vWN.x); float sk = fN(vec2(sa * 4.0 + floor(wp.x * 0.5) * 3.1, 1.7)) * fN(vec2(sa * 13.0, wp.y * 0.35 + 5.0)); diffuseColor.rgb *= 1.0 - (0.4 * fZinc + 0.2 * fEnam * step(0.5, 1.0 - abs(vWN.y))) * smoothstep(0.3, 0.62, sk); diffuseColor.rgb *= 1.0 - 0.1 * fEnam * smoothstep(0.45, 0.8, n2); }
          // a lit side and a shade side: the sky opposite the sun and the street below give less light than the even sky light assumes
          float sunSide = dot(normalize(vWN) * fFace, uSunDir);
          diffuseColor.rgb *= mix(0.58 + 0.3 * fSheet + 0.12 * fZinc + 0.24 * fArm - 0.04 * fEnam * step(0.045, vFw.y), 1.0 + 0.12 * fZinc, smoothstep(-0.5, 0.25, sunSide)) * mix(0.72 - 0.14 * fEnam * step(0.045, vFw.y), 1.0, smoothstep(-0.95, -0.2, vWN.y * fFace));
          { float eb = fEnam * step(0.045, vFw.y) * smoothstep(0.3, 0.95, sunSide); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + vec3(0.0, 0.085, 0.022), eb); }
          fVis = step(0.057, vFw.y) * step(vFw.y, 0.063) * step(fFace, 0.0);                  // the inside of a visor: matt black, a little lighter toward its mouth
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.03, 0.028) * (1.0 + 3.5 * smoothstep(0.2, 1.0, clamp(vHL.x / max(0.05, vHL.w), 0.0, 1.0))), fVis);
          float fGlass = step(0.036, vFw.y) * step(vFw.y, 0.044);
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb * 0.7, fGlass); fGloss *= 1.0 - fGlass;
          fShade = max(fVis, fGlass); bakeV.r *= 1.0 - 0.78 * fVis - 0.2 * fGlass;` : `
          diffuseColor.rgb *= 0.86 + 0.2 * n2; fRust = 0.0; fGloss = 0.0; fEnam = 0.0; fVis = 0.0; fShade = 0.0; fHsh = 0.0; fBump = 0.0; fPole = 0.0; fPoleR = 0.0; fArm = 0.0;`}
          fBase = smoothstep(0.5, 0.0, vFw.z) * (0.35 + 0.65 * n2) + 0.25 * (1.0 - 0.85 * fEnam) * smoothstep(0.62, 0.9, n1 * n2 * 2.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.054, 0.047), clamp(fBase, 0.0, 1.0) * 0.62);
          fEmit = diffuseColor.rgb * max(0.0, -vFw.x) + diffuseColor.rgb * 0.5 * fArm * (0.35 + 0.65 * smoothstep(0.3, -0.7, vWN.y)) * bakeV.g;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (fPole > 0.0) { vec2 bD = vec2(dFdx(fBump), dFdy(fBump)) * 0.007; vec3 bSx = dFdx(-vViewPosition), bSy = dFdy(-vViewPosition), bR1 = cross(bSy, normal), bR2 = cross(normal, bSx); float bDet = dot(bSx, bR1);
          normal = normalize(abs(bDet) * normal - sign(bDet) * (bD.x * bR1 + bD.y * bR2)); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n        totalEmissiveRadiance += fEmit;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - 0.42 * fEnam + 0.22 * step(0.036, vFw.y) * step(vFw.y, 0.044) - 0.16 * step(0.4, vFw.y) * step(vFw.y, 0.44) + 0.7 * fVis + fGloss + 0.35 * fRust + 0.3 * fBase + 1.4 * fPoleR, 0.06, 1.0);      // metal value 0.05 marks glossy enamel`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${f ? 'metalnessFactor = vFw.y * step(0.07, vFw.y) * (1.0 - fRust) * (1.0 - 0.6 * clamp(fBase, 0.0, 1.0)) * (1.0 - 0.75 * fArm);' : ''}`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + BAKE_LIGHT_GLSL + '\n        reflectedLight.indirectSpecular *= 1.0 - 0.88 * fVis - 0.2 * (fShade - fVis); reflectedLight.indirectDiffuse *= 1.0 - 0.5 * fShade; reflectedLight.directSpecular *= (1.0 - 0.92 * fShade) * (1.0 - fHsh) * (1.0 + 3.0 * fEnam * step(0.045, vFw.y)); reflectedLight.directDiffuse *= (1.0 - 0.75 * fShade) * (1.0 - 0.93 * fHsh);');
  };
  const key = 'stfurn51' + mode + extra.length + (m.transparent ? 't' : 'o');
  m.customProgramCacheKey = () => key;
  return m;
}

// ------------------------------------------------------------------------------------------------ prototype builder
const GAL = { w: [0.035, 0.42] }, PAINT = { w: [0.3, 0] }, IRON = { w: [0.36, 0.25] }, PLAIN = { w: [0, 0] }, STEEL = { w: [0.12, 0.7] };
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
    out.setAttribute('color', new THREE.BufferAttribute(c, 3)); out.setAttribute('aW', new THREE.BufferAttribute(w, 4)); { const hl = new Float32Array(n * 4); for (let i = 0; i < n; i++) hl[i * 4] = 1000; out.setAttribute('aHL', new THREE.BufferAttribute(hl, 4)); }
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
    this.push(new THREE.PlaneGeometry(w, h, o.seg || 1, 1), o.col || WHITE, Object.assign({ w: [0.05, 0] }, o, { cell }), this.mat([c[0] + nz.x * off, c[1] + nz.y * off, c[2] + nz.z * off], o));
    if (o.double) { const o2 = Object.assign({}, o, { ry: (o.ry || 0) + PI }); if (o.back !== undefined) { if (o.back === null) { o2.col = o.backCol || C('#7d8182'); return this.push(new THREE.PlaneGeometry(w, h), o2.col, { w: [0.1, 0.4] }, this.mat([c[0] - nz.x * off, c[1] - nz.y * off, c[2] - nz.z * off], o2)); } Object.assign(o2, o.back); }
      this.push(new THREE.PlaneGeometry(w, h, o.seg || 1, 1), o2.col || WHITE, Object.assign({ w: [0.05, 0] }, o2, { cell: o2.cell || cell }), this.mat([c[0] - nz.x * off, c[1] - nz.y * off, c[2] - nz.z * off], o2)); }
    return this;
  }
  // a patch of the atlas wrapped on a vertical pole of radius r, centred at height y and angle ang (0 = +Z, PI/2 = +X)
  wrap(cell, r, y, ang, w, h, o = {}) { const g = new THREE.CylinderGeometry(r, r, h, Math.max(4, Math.ceil(w / r * 5)), 1, true, ang - w / (2 * r), w / r); return this.push(g, o.col || WHITE, Object.assign({ w: [0.05, 0] }, o, { cell }), this.mat([o.x || 0, y, o.z || 0])); }
  merge(pb, m) { for (const g of pb.list) { const c = g.clone(); c.applyMatrix4(m); this.list.push(c); } return this; }
  // mark every piece as part of a signal head: its position in the head's own frame (lens radius scaled to 0.15), the head's yaw in the prototype
  tagHead(s, yaw) { for (const g of this.list) { const P = g.attributes.position, H = g.attributes.aHL; for (let i = 0; i < P.count; i++) H.setXYZW(i, P.getX(i) / s, P.getY(i) / s, P.getZ(i) / s, yaw + (s < 0.9 ? 100 : 0)); } return this; }
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
const headM = (h) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(h.tx || 0, h.yaw, h.tz || 0, 'YXZ')).setPosition(h.x, h.y, h.z);
// a shallow dome (a signal lens): rim circle of radius rc in the plane x = 0, bulging toward +X; uv = a flat projection of the disc
function domeGeo(rc, ws = 16, hs = 3) { const a = 0.38, Rs = rc / Math.sin(a), g = new THREE.SphereGeometry(Rs, ws, hs, 0, TAU, 0, a); g.rotateZ(-PI / 2); g.translate(-Rs * Math.cos(a), 0, 0);
  const Pd = g.attributes.position, U = g.attributes.uv; for (let q = 0; q < Pd.count; q++) U.setXY(q, 0.5 + Pd.getZ(q) / (2 * rc), 0.5 + Pd.getY(q) / (2 * rc)); return g; }
// ------------------------------------------------------------------------------------------------ the prototypes
function roundBox(sx, sy, sz, rr, n = 6) { const t0 = n === 6 ? 1 / 3 : 0.5, rb = mergeVertices(new THREE.BoxGeometry(2, 2, 2, n, n, n)), Pr = rb.attributes.position, Nr = rb.attributes.normal, hh = [sx / 2, sy / 2, sz / 2];
  for (let q = 0; q < Pr.count; q++) { const t = [Pr.getX(q), Pr.getY(q), Pr.getZ(q)], v = t.map((a, k) => { const m = Math.abs(a), h = hh[k]; return Math.sign(a) * (m <= t0 + 1e-6 ? m / t0 * (h - rr) : h - rr + rr * Math.tan((m - t0) / (1 - t0) * PI / 4)); }),
      c = v.map((a, k) => Math.max(-(hh[k] - rr), Math.min(hh[k] - rr, a))), dd = Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]) || 1; Pr.setXYZ(q, c[0] + (v[0] - c[0]) / dd * rr, c[1] + (v[1] - c[1]) / dd * rr, c[2] + (v[2] - c[2]) / dd * rr); Nr.setXYZ(q, (v[0] - c[0]) / dd, (v[1] - c[1]) / dd, (v[2] - c[2]) / dd); }
  return rb; }
function buildProtos(A, A2) {
  const P = {}, pb = () => new PB(A);
  const cGalv = C('#8d9293'), cGalvD = C('#7b8081'), cYel = C('#dba514'), cYelD = C('#b98a10'), cBlk = C('#111213'), cConc = C('#77736a'), cIron = C('#15171a');
  const stickers = (b, r, n, seed, y0 = 0.9, y1 = 2.3) => { for (let i = 0; i < n; i++) { const fl = hsh(seed, i, 9) < 0.22, s = fl ? 0.14 : 0.055 + 0.05 * hsh(seed, i, 1); b.wrap(fl ? 'flyer' : 'sticker', r + 0.003, y0 + (y1 - y0) * hsh(seed, i, 2), hsh(seed, i, 3) * TAU, fl ? s * 0.75 : s, s, { vary: !fl, ci: fl ? i % 4 : i % 4, cj: fl ? 0 : i % 2 }); } };
  // the cast base, footing and shaft every city pole stands on
  const pole = (b0, top, r0, r1, seed, bs = 1) => { const b = bs === 1 ? b0 : pb();
    const cast = C('#8b9091'), CI = { w: [0.14, 0.22] };
    b.box([0, 0.006, 0], [0.74, 0.012, 0.74], C('#4a4844'), { w: [0.5, 0] }); b.box([0, 0.026, 0], [0.68, 0.036, 0.68], C('#35373a'), { w: [0.6, 0.35] });
    for (const [x, z] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) { b.cyl([x, 0.05, z], [x, 0.1, z], 0.034, 0.034, C('#2e241c'), { w: [0.9, 0.2], seg: 6, cap: true }); b.cyl([x, 0.1, z], [x, 0.14, z], 0.014, 0.014, C('#3b2a1e'), { w: [0.9, 0.2], seg: 5, cap: true }); }
    b.lathe([[0.31, 0.02], [0.31, 0.06], [0.275, 0.08], [0.275, 0.13], [0.24, 0.21], [0.22, 0.55], [0.232, 0.56], [0.232, 0.6], [0.215, 0.61], [0.2, 0.86], [0.175, 0.93], [r0 + 0.014, 0.97]], cast, { w: [0.14, 0.22], seg: 8, spin: PI / 8 });
    for (let k = 0; k < 8; k++) { const a = k * PI / 4; b.box([0.2 * Math.cos(a), 0.4, 0.2 * Math.sin(a)], [0.05, 0.36, 0.028], C('#8f9392'), { w: [0.14, 0.22], ry: -a + PI / 2 }); }
    b.box([0, 0.38, -0.215], [0.15, 0.25, 0.022], C('#a3a7a6'), CI); for (const [x, y] of [[0.06, 0.48], [-0.06, 0.48], [0.06, 0.28], [-0.06, 0.28]]) b.box([x, y, -0.213], [0.016, 0.016, 0.01], C('#1b1c1d'), CI);
    for (let k = 0; k < 4; k++) { const a = PI / 4 + k * PI / 2, x = 0.275 * Math.cos(a), z = 0.275 * Math.sin(a); b.cyl([x, 0.05, z], [x, 0.115, z], 0.024, 0.024, C('#2e241c'), { w: [0.9, 0.2], seg: 6, cap: true }); b.cyl([x, 0.115, z], [x, 0.145, z], 0.011, 0.011, C('#3b2a1e'), { w: [0.9, 0.2], seg: 5, cap: true }); }
    if (b !== b0) b0.merge(b, new THREE.Matrix4().makeScale(bs, bs, bs));
    if (!(HH && !MID && bs === 1)) b0.cyl([0, 0.97 * bs, 0], [0, top, 0], r0, r1, cGalv, Object.assign({ seg: MID ? 8 : 18, spin: PI / 8 }, GAL)); if (bs !== 1) { b0.wrap('sticker', r0 + 0.004, 1.72, PI * 0.5 + seed, 0.08, 0.11, { col: C('#d8d4c4'), ci: 7, cj: 3 }); return; }
    
    b.cyl([0, 0.95, 0], [0, 1.02, 0], r0 + 0.016, r0 + 0.012, cast, { w: [0.14, 0.22], seg: 8, spin: PI / 8 });
    b.wrap('sticker', r0 + 0.004, 1.72, PI * 0.5 + seed, 0.08, 0.11, { col: C('#d8d4c4'), ci: 7, cj: 3 });   // the pole's number tag
  };
  // a three-section vehicle head; origin at the centre of the middle lens face, lenses face +X. R = lens radius
  const cHead = C(HHEAD.CW ? '#c08f33' : '#ffa500'), cHeadD = C(HHEAD.CW ? '#9c7426' : '#e08d05'), cPed = C('#a06a22'), cPedD = C('#86581c'), HP = { w: [0.07, 0.05] }, VIS = { w: [0.07, 0.06] };
  let MID = false;      // true while the mid-detail poles are being built
  let HH = false;       // true while the hero poles are being built: their near heads are the Blender-built head, one plumb head at the arm tip
  const head = (b, R, side) => {
    const s = R / 0.15, w = 0.345 * s, d = 0.27;
    if (!HH || (MID && !HHEAD.CW)) for (let k = -1; k <= 1; k++) {
      // one section: a housing with a round door, a long tunnel visor cut away underneath, hinge and latch
      { const tv = 0.9 + 0.2 * hsh(k, R * 77, side + 5), sc = [cHead[0] * tv, cHead[1] * (tv - 0.03 + 0.08 * hsh(k, R * 31, 2)), cHead[2]]; b.push(roundBox(d - 0.04, w - 0.014, w - 0.02, 0.046 * s, MID ? 4 : 6), sc, HP, b.mat([-d / 2 - 0.02, k * w, 0]));
        if (!MID) for (const sg of [-1, 1]) for (const dy of [0.11, -0.11]) { b.cyl([-0.1, k * w + dy * s, sg * (w / 2 - 0.012)], [-0.1, k * w + dy * s, sg * (w / 2 - 0.002)], 0.008 * s, 0.008 * s, cHeadD, Object.assign({ seg: 6, cap: true }, HP)); } }
      b.cyl([-0.045, k * w, 0], [0.004, k * w, 0], R * 1.085, R * 1.085, cHead, Object.assign({ seg: MID ? 10 : 24 }, HP)); b.cyl([0.0, k * w, 0], [0.012, k * w, 0], R * 1.105, R * 1.03, [0.02, 0.02, 0.018], { seg: MID ? 10 : 24, cap: true, w: [0, 0.04] });
      b.box([-d - 0.012, k * w, 0], [0.03, w * 0.8, w * 0.78], cHeadD, HP); 
      if (!MID) for (const dy of [0.075, -0.075]) b.cyl([-0.024, k * w + (dy - 0.026) * s, -R * 1.135], [-0.024, k * w + (dy + 0.026) * s, -R * 1.135], 0.015 * s, 0.015 * s, cHeadD, Object.assign({ seg: 8, cap: true }, HP)); { const ly = k * w + (hsh(k, R * 37, 11 + side) - 0.5) * 0.09 * s; b.cyl([-0.03, ly, R * 1.1], [-0.03, ly, R * 1.1 + 0.02], 0.007 * s, 0.007 * s, cHeadD, Object.assign({ seg: 6, cap: true }, HP)); b.sph([-0.03, ly, R * 1.1 + 0.026], [0.013 * s, 0.028 * s, 0.01 * s], C('#b9bcba'), STEEL); }
      // the lens: a shallow dome of dark tinted glass in the shade of its visor (darker toward the top)
      { const lc = k === 1 ? C('#7c2219') : k === 0 ? C('#765a12') : C('#145c46'); b.push(MID ? domeGeo(R, 8, 1) : domeGeo(R), lc, { w: [0, 0.04], colFn: (px, py) => { const f = 0.35 + 0.65 * Math.min(1, Math.max(0, 0.5 - (py - k * w) / (2 * R))); return [lc[0] * f, lc[1] * f, lc[2] * f]; } }, b.mat([0.014, k * w, 0])); }
      // tunnel visor: one skin of sheet metal (the shader paints its inside matt black), cut away underneath
      { const VL = 0.25 * Math.sqrt(s) * (0.95 + 0.1 * hsh(k, R * 51, 7 + side)), v1 = new THREE.CylinderGeometry(R * 1.03, R * 1.045, VL, MID ? 18 : 48, MID ? 1 : 3, true, PI * 0.64, PI * 1.72); v1.rotateZ(-PI / 2); const Pv = v1.attributes.position;
        for (let q = 0; q < Pv.count; q++) { const t = (Pv.getX(q) + VL / 2) / VL, y = Pv.getY(q), z = Pv.getZ(q), rr2 = Math.hypot(y, z), ph = Math.atan2(z, y) * (1 - 0.07 * t); Pv.setY(q, rr2 * Math.cos(ph)); Pv.setZ(q, rr2 * Math.sin(ph)); }
        for (let q = 0; q < Pv.count; q++) { const t = (Pv.getX(q) + VL / 2) / VL, f = 0.8 + 0.2 * Math.min(1, Math.max(0, (Pv.getY(q) / R + 0.75) / 1.5)); Pv.setX(q, -VL / 2 + t * VL * f); } v1.computeVertexNormals();
        b.push(v1, cHead, VIS, b.mat([-0.014 + VL / 2, k * w, 0], { ry: (hsh(k, R * 100, 3 + side) - 0.5) * 0.09, rz: (hsh(k, R * 100, 4 + side) - 0.5) * 0.1 })); }
    }
    const top = 1.5 * w, yb = top + 0.07;
    const bx = HH ? -0.135 * s : -d / 2;
    if (side) for (const y of [yb - 0.03, -yb + 0.03]) { b.cyl([bx, y, 0], [bx, y, side * 0.44], 0.026, 0.026, cHeadD, HP); b.cyl([bx, y - 0.05, 0], [bx, y + 0.05, 0], 0.032, 0.032, cHeadD, HP); }
    else if (!HH) { b.cyl([-0.36, -yb, 0], [-0.36, yb, 0], 0.03, 0.03, cHead, HP); for (const y of [yb, -yb]) { b.cyl([-0.36, y, 0], [-d / 2, y, 0], 0.03, 0.03, cHead, HP); b.sph([-0.36, y, 0], 0.036, cHeadD, HP); b.cyl([-d / 2, y, 0], [-d / 2, y - Math.sign(y) * 0.075, 0], 0.032, 0.032, cHeadD, HP); } }
  };
  const pedHead = (b) => {   // origin at the face centre, facing +X
    b.push(roundBox(0.2, 0.46, 0.46, 0.04, MID ? 4 : 6), cPed, HP, b.mat([-0.1, 0, 0])); b.box([-0.206, 0, 0], [0.014, 0.37, 0.37], cPedD, HP);
    for (const [y, z, sy, sz, dx] of [[0.218, 0, 0.012, 0.448, 0.17], [-0.218, 0, 0.012, 0.448, 0.1], [0, 0.218, 0.448, 0.012, 0.135], [0, -0.218, 0.448, 0.012, 0.135]]) b.box([dx / 2 - 0.004, y, z], [dx, sy, sz], cPed, VIS);
    for (const yy of [0.14, -0.14]) b.cyl([-0.03, yy - 0.028, 0.236], [-0.03, yy + 0.028, 0.236], 0.01, 0.01, cPed, Object.assign({ seg: 8, cap: true }, HP)); b.cyl([-0.03, 0, -0.232], [-0.03, 0, -0.25], 0.008, 0.008, C('#8d9190'), Object.assign({ seg: 6, cap: true }, STEEL)); b.sph([-0.03, 0, -0.254], [0.009, 0.018, 0.007], C('#8d9190'), STEEL);
    b.box([-0.012, 0, 0.2315], [0.004, 0.42, 0.003], C('#3a2c06'), PLAIN); b.box([-0.012, 0, -0.2315], [0.004, 0.42, 0.003], C('#3a2c06'), PLAIN);
    if (!MID) for (const sg of [-1, 1]) for (const [x, y] of [[-0.16, 0.17], [-0.16, -0.17], [-0.06, 0.17], [-0.06, -0.17]]) b.cyl([x, y, sg * 0.229], [x, y, sg * 0.236], 0.008, 0.008, cPedD, Object.assign({ seg: 6, cap: true }, HP));
    b.quad('ped', [0.004, 0, 0], 0.4, 0.4, { ry: PI / 2, ci: 2, w: [0, 0.2] });
    if (!MID) { b.quad('sticker', [-0.1, 0.1, 0.2305], 0.06, 0.06, { ci: 3, cj: 1 }); b.cyl([-0.1, -0.23, 0], [-0.1, -0.26, 0], 0.016, 0.016, C('#2a2b2c'), { w: [0.1, 0.3], seg: 8, cap: true }); for (const yy of [0.08, 0, -0.08]) b.box([-0.2135, yy, 0], [0.003, 0.012, 0.22], C('#2a2206'), PLAIN); }
  };
  // ---- signal pole with mast arm; L = arm length. Returns where the lenses and pedestrian faces are, for the lit lamps
  const armYof = (L) => (z) => { const t = Math.min(1, Math.max(0, z / L)); return 5.2 + 1.2 * Math.pow(Math.sin(PI / 2 * t), 0.8); };
  const signal = (L, seed) => {
    const b = pb(), armY = armYof(L), TOP = 6.95, pr = (y) => 0.14 - 0.042 * (y - 0.97) / (TOP - 0.97);
    pole(b, TOP, 0.14, 0.098, seed); b.cyl([0, TOP - 0.02, 0], [0, TOP + 0.05, 0], 0.11, 0.105, cGalvD, { w: [0.3, 0.25], seg: 8, cap: true }); b.sph([0, TOP + 0.1, 0], 0.06, cGalvD, GAL); b.cyl([0, TOP + 0.15, 0], [0, TOP + 0.22, 0], 0.012, 0.004, cGalvD, { seg: 5 });
    if (L > 7) { b.cyl([0, TOP + 0.05, 0], [0, TOP + 1.1, 0], 0.085, 0.07, cGalv, Object.assign({ seg: 8 }, GAL)); b.tube([[0, TOP + 1.05, 0], [0, TOP + 1.55, 0.25], [0, TOP + 1.78, 0.9], [0, TOP + 1.8, 1.9]], 0.042, cGalv, Object.assign({ n: 12, seg: 7 }, GAL));
      b.sph([0, TOP + 1.76, 2.2], [0.17, 0.075, 0.4], C('#7d8184'), { w: [0.2, 0.25], seg: 10, rings: 6 }); b.box([0, TOP + 1.7, 2.22], [0.2, 0.012, 0.5], C('#d9dccf'), { w: [0, 0.1] }); }
    // the arm: thick at the pole, tapering and curving up to the tip
    { const NS = MID ? 10 : 22, SD = MID ? 6 : 10, pos = [], idx = [], ra = (t) => 0.092 - 0.046 * t; for (let k = 0; k <= NS; k++) { const t = k / NS, z = Math.max(0.05, L * t), y = armY(z), dz = 0.05, sl = Math.atan2(armY(z + dz) - armY(Math.max(0, z - dz)), z + dz - Math.max(0, z - dz)), r = ra(t);
        for (let q = 0; q < SD; q++) { const a = q / SD * TAU, cx = Math.cos(a) * r, cy = Math.sin(a) * r; pos.push(cx, y + cy * Math.cos(sl), z - cy * Math.sin(sl)); } }
      for (let k = 0; k < NS; k++) for (let q = 0; q < SD; q++) { const a = k * SD + q, b2 = k * SD + (q + 1) % SD, c2 = a + SD, d2 = b2 + SD; idx.push(a, c2, b2, b2, c2, d2); }
      const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ag.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); ag.setIndex(idx); ag.computeVertexNormals(); b.push(ag, C('#c0c4c4'), { w: [0.035, 0.435] }); }
    b.cyl([0, 4.98, 0], [0, 5.42, 0], pr(5.0) + 0.022, pr(5.4) + 0.02, cGalvD, { w: [0.35, 0.25], seg: 8, spin: PI / 8 }); b.box([0, 5.2, 0.15], [0.28, 0.34, 0.06], cGalvD, { w: [0.4, 0.25] });
    for (const [x, y] of [[0.1, 5.32], [-0.1, 5.32], [0.1, 5.08], [-0.1, 5.08]]) { b.cyl([x, y, 0.18], [x, y, 0.215], 0.016, 0.016, C('#3a3d3d'), { w: [0.6, 0.3], seg: 6, cap: true }); }
    if (HH) b.sph([0, armY(L), L], [0.047, 0.047, 0.016], cGalvD, GAL); else b.sph([0, armY(L), L], 0.054, cGalvD, GAL);
    for (const [gf, gx] of [[0.42, -0.035], [0.72, 0.035]]) { const gz = L * gf, gy = armY(gz) + 0.05, A0 = [gx, TOP - 0.08, 0.06], B0 = [gx * 0.4, gy, gz], rod = C('#8b9091'), RD = { w: [0.05, 0.45], seg: 6 };
      b.cyl(A0, B0, 0.015, 0.015, rod, RD); const tm = 0.3, M0 = A0.map((a, k) => a + (B0[k] - a) * tm), M1 = A0.map((a, k) => a + (B0[k] - a) * (tm + 0.22 / Math.hypot(B0[1] - A0[1], B0[2] - A0[2]))); b.cyl(M0, M1, 0.015, 0.015, cGalvD, { w: [0.3, 0.4], seg: 6, cap: true });
      b.box([gx * 0.4, gy - 0.03, gz], [0.03, 0.07, 0.05], cGalvD, { w: [0.3, 0.4] }); b.cyl([-0.09, armY(gz), gz - 0.02], [0.09, armY(gz), gz - 0.02], 0.012, 0.012, cGalvD, { w: [0.3, 0.4], seg: 6, cap: true }); }
    b.cyl([0, TOP - 0.14, 0], [0, TOP - 0.02, 0], 0.118, 0.115, cGalvD, { w: [0.3, 0.3], seg: 10 }); b.box([0, TOP - 0.08, 0.1], [0.12, 0.08, 0.1], cGalvD, { w: [0.3, 0.4] });
    const heads = [], place = (h, x, y, z, yaw, s, tx = 0, tz = 0) => { const o = { x, y, z, yaw, s, tx, tz }; h.tagHead(s, yaw); b.merge(h, headM(o)); heads.push(o); };
    const HANG = HH ? 0.835 : L > 7 ? 0.85 : 0.2; const extra = []; if (L > 7 && !HH) { const z = L - 0.32, y = armY(z) - HANG; for (const [x, zz, yaw, opp] of [[-0.04, z + 0.47, -PI / 2, 1]]) { const h = pb(); head(h, 0.15, 0); const o = { x, y: y - 0.025, z: zz, yaw: yaw + 0.07, s: 1, opp, tx: 0.055, tz: -0.045 }; h.tagHead(1, yaw); b.merge(h, headM(o)); extra.push(o); }
      b.cyl([-0.07, y + 0.59, z - 0.02], [-0.07, y + 0.59, z + 0.42], 0.028, 0.028, cHead, HP); b.cyl([-0.07, y - 0.59, z - 0.02], [-0.07, y - 0.59, z + 0.42], 0.028, 0.028, cHead, HP); for (const yy of [y + 0.59, y - 0.59]) { b.cyl([-0.07, yy, z + 0.1], [0.2, yy, z + 0.02], 0.026, 0.026, cHead, HP); b.cyl([-0.07, yy, z + 0.39], [-0.07, yy + (yy > y ? -0.07 : 0.07), z + 0.39], 0.032, 0.032, cHead, HP); } b.cyl([0, y + 0.59, z], [0, armY(z), z], 0.034, 0.034, cHead, HP); b.cyl([0, y + 0.56, z], [0, y + 0.64, z], 0.05, 0.05, cHeadD, Object.assign({ seg: 10, cap: true }, HP)); b.cyl([0, armY(z) - 0.11, z], [0, armY(z) - 0.06, z], 0.048, 0.048, cHeadD, Object.assign({ seg: 10, cap: true }, HP)); }
    if (L > 7) { const z = L - 2.9, y = armY(z) - 0.16; b.box([0.085, y, z], [0.006, 0.76, 0.51], C('#b9bcba'), { w: [0.12, 0.3], rx: -0.012 });
      for (const dz of [-0.17, 0.17]) { b.box([0.045, armY(z + dz), z + dz], [0.09, 0.15, 0.035], C('#4a4d4d'), { w: [0.3, 0.4] }); if (HH && HHEAD.HB) { const zz = z + dz, ra = 0.092 - 0.046 * zz / L + 0.0035, sl = (armY(zz + 0.05) - armY(zz - 0.05)) / 0.1; b.cyl([0, armY(zz) - sl * 0.013, zz - 0.013], [0, armY(zz) + sl * 0.013, zz + 0.013], ra, ra, C('#303233'), { w: [0.3, 0.4], seg: 20, cap: true }); } else b.cyl([-0.07, armY(z + dz), z + dz - 0.03], [-0.07, armY(z + dz), z + dz + 0.03], 0.075, 0.075, C('#4a4d4d'), { w: [0.3, 0.4], seg: 8 }); } }
    (L > 7 ? [[L - (HH ? 1.0 : 0.32), -0.16]] : [[L - (HH ? 0.8 : 0.32), -0.16], [L - 2.9, 0.2]]).forEach(([z, yaw]) => { const h = pb(); head(h, 0.15, 0); const y = armY(z) - HANG; if (HH) { const yw = yaw - (L > 7 ? 0.09 : 0); place(h, 0.135 * Math.cos(yw), y, z - 0.135 * Math.sin(yw), yw, 1, 0.012, -0.008); heads[heads.length - 1].tip = 1; } else place(h, 0.36, y, z, yaw - (L > 7 ? 0.09 : 0), 1, L > 7 ? -0.04 : -0.02, L > 7 ? 0.05 : 0.03); if (!HH) b.box([0, armY(z), z], [0.14, 0.14, 0.12], cGalvD, { w: [0.5, 0.4] });
      { const S0 = HH ? [0, armY(z - 0.34) - 0.04, z - 0.34] : [0, armY(z - 0.62) - 0.25, z - 0.62], E0 = HH ? [-0.06, y + 0.7225, z - 0.02] : [0.2, y + 0.55, z - 0.03], sag = HH ? (HHEAD.HB ? 0.17 : 0.1) : 0.42, pts = []; for (let q = 0; q <= 8; q++) { const t = q / 8; pts.push([S0[0] + (E0[0] - S0[0]) * t + (HH && HHEAD.HB ? -0.10 * Math.sin(PI * t) : 0.05 * Math.sin(t * 9.0)), S0[1] + (E0[1] - S0[1]) * t - sag * 4 * t * (1 - t) * (1 - 0.5 * t) + (HH && HHEAD.HB ? 0 : 0.03 * Math.sin(t * 14.0)), S0[2] + (E0[2] - S0[2]) * t]); } b.tube(pts, HH ? (HHEAD.HB ? 0.011 : 0.0085) : 0.014, C('#0d0d0e'), { n: 32, seg: 6, w: [0, 0] }); if (HH && HHEAD.HB) { const p2 = []; for (let q = 0; q <= 8; q++) { const t = q / 8; p2.push([S0[0] + (E0[0] - S0[0]) * t + 0.085 * Math.sin(PI * t), S0[1] + (E0[1] - S0[1]) * t - 0.11 * 4 * t * (1 - t) * (1 - 0.3 * t), S0[2] + (E0[2] - S0[2]) * t + 0.03 * Math.sin(PI * t)]); } b.tube(p2, 0.0075, C('#101112'), { n: 32, seg: 6, w: [0, 0] }); } }
      if (HH) { b.cyl([0, armY(z - 0.34) - 0.03, z - 0.34], [0, armY(z - 0.34) - 0.075, z - 0.34], 0.016, 0.013, cGalvD, { w: [0.3, 0.4], seg: 8, cap: true }); } else { b.box([0, armY(z - 0.62) - 0.15, z - 0.62], [0.11, 0.19, 0.15], cGalvD, { w: [0.3, 0.3] }); b.box([0, armY(z - 0.62) - 0.15, z - 0.62 + 0.078], [0.07, 0.12, 0.006], C('#6f7476'), { w: [0.3, 0.3] }); }
      for (const dz of [-0.075, 0.075]) { const zz = z + dz, G5 = HH && HHEAD.HB, ra = 0.092 - 0.046 * zz / L + (G5 ? 0.0035 : 0.01), hw = G5 ? 0.011 : 0.016, sl = G5 ? (armY(zz + 0.05) - armY(zz - 0.05)) / 0.1 : 0; b.cyl([0, armY(zz) - sl * hw, zz - hw], [0, armY(zz) + sl * hw, zz + hw], ra, ra, C(G5 ? '#303233' : '#4a4d4d'), { w: [0.3, 0.4], seg: G5 ? 20 : 8, cap: G5 }); if (G5) b.box([0, armY(zz) + ra + 0.003, zz], [0.024, 0.008, 0.028], C('#3a3d3d'), { w: [0.3, 0.4] }); } });
    if (HH && HHEAD.CW) { const h = pb(); head(h, 0.15, 1); place(h, 0.135, 4.38, -0.44, 0.1, 1, 0.015, -0.025); }      /* city rule: the pole-side head is the same 12-inch head as the arm's (0.345 m a section, 1.07 m tall), not a 0.7 copy */
    else { const h = pb(); head(h, 0.105, 1); place(h, 0.135, 4.5, -0.44, 0.1, 0.7, 0.015, -0.025); }
    // a conduit up the back of the pole, a junction box, straps
    b.box([-pr(2.95) - 0.05, 2.95, 0.03], [0.1, 0.22, 0.14], cGalv, GAL); b.box([-pr(2.95) - 0.103, 2.95, 0.03], [0.006, 0.2, 0.12], cGalvD, { w: [0.2, 0.42] }); for (const [dy, dz] of [[0.085, 0.045], [0.085, -0.045], [-0.085, 0.045], [-0.085, -0.045]]) b.cyl([-pr(2.95) - 0.106, 2.95 + dy, 0.03 + dz], [-pr(2.95) - 0.11, 2.95 + dy, 0.03 + dz], 0.006, 0.006, C('#3a3d3d'), { w: [0.3, 0.4], seg: 6, cap: true }); b.cyl([-pr(2.95) - 0.05, 2.82, 0.03], [-pr(2.95) - 0.05, 2.84, 0.03], 0.024, 0.024, cGalvD, { w: [0.3, 0.42], seg: 8 });
    for (const y of [1.45, 2.05]) { b.cyl([0, y, 0], [0, y + 0.019, 0], pr(y) + 0.004, pr(y) + 0.004, C('#b9bdbc'), { w: [0.02, 0.7], seg: MID ? 8 : 18, spin: PI / 8 }); b.box([pr(y) * 0.7071 + 0.004, y + 0.0095, pr(y) * 0.7071 + 0.004], [0.03, 0.024, 0.01], C('#b9bdbc'), { w: [0.02, 0.7], ry: -PI / 4 }); }
    b.tube([[-pr(4.3), 4.3, 0.03], [-0.15, 4.6, -0.2], [0, 4.9, -0.44]], 0.011, C('#0d0d0e'), { n: 6, seg: 4, w: [0, 0] });
    if (L > 7) { b.cyl([0, armY(L * 0.8), L * 0.8], [0, armY(L * 0.8) + 0.3, L * 0.8], 0.02, 0.02, cGalvD, GAL); b.cyl([-0.08, armY(L * 0.8) + 0.4, L * 0.8], [0.18, armY(L * 0.8) + 0.33, L * 0.8], 0.06, 0.06, C('#c9cbc8'), { w: [0.15, 0.1], seg: 10, cap: true }); b.box([0.04, armY(L * 0.8) + 0.47, L * 0.8], [0.34, 0.012, 0.15], C('#b9bbb8'), { w: [0.15, 0.1], rz: -0.25 }); const cl = new THREE.CircleGeometry(0.045, 12); cl.rotateY(PI / 2); cl.rotateZ(-0.26); b.push(cl, C('#0b0d10'), { w: [0, 0.5] }, b.mat([0.183, armY(L * 0.8) + 0.33, L * 0.8])); }
    // pedestrian heads: A faces +X on the sidewalk side, B faces +Z (across the approach) on the +X side
    const peds = [{ x: 0.1, y: 2.47, z: -0.48, ry: 0 }, { x: 0.48, y: 2.47, z: 0.1, ry: -PI / 2 }];
    if (!(HH && !MID && HHEAD.ped)) for (const q of peds) { const h = pb(); pedHead(h); b.merge(h, new THREE.Matrix4().makeRotationY(q.ry).setPosition(q.x, q.y, q.z)); }
    for (const y of [2.74, 2.2]) { b.cyl([0, y, 0], [0, y, -0.48], 0.026, 0.026, cPed, HP); b.cyl([0, y, 0], [0.48, y, 0], 0.026, 0.026, cPed, HP); for (const [x, z] of [[0, -0.48], [0.48, 0]]) { b.sph([x, y, z], 0.036, cPed, HP); b.cyl([x, y, z], [x, y + (y > 2.47 ? -0.05 : 0.05), z], 0.03, 0.03, cPed, HP); } for (const dy of [-0.026, 0.026]) b.cyl([0, y + dy - 0.0095, 0], [0, y + dy + 0.0095, 0], pr(y) + 0.004, pr(y) + 0.004, C('#b9bdbc'), { w: [0.02, 0.7], seg: MID ? 8 : 18, spin: PI / 8 }); b.cyl([0, y - 0.014, 0], [0, y + 0.014, 0], pr(y) + 0.012, pr(y) + 0.012, cPed, Object.assign({ seg: MID ? 8 : 18 }, HP)); b.box([0, y, -pr(y) - 0.012], [0.085, 0.095, 0.05], cPedD, HP); b.box([pr(y) + 0.012, y, 0], [0.05, 0.095, 0.085], cPedD, HP); for (const [x, z] of [[-0.7071, -0.7071], [0.7071, 0.7071]]) { b.box([x * (pr(y) + 0.03), y, z * (pr(y) + 0.03)], [0.05, 0.06, 0.02], cPed, Object.assign({ ry: PI / 4 }, HP)); b.cyl([x * (pr(y) + 0.035) - 0.012, y, z * (pr(y) + 0.035) + 0.012], [x * (pr(y) + 0.035) + 0.012, y, z * (pr(y) + 0.035) - 0.012], 0.008, 0.008, C('#8d9190'), Object.assign({ seg: 6, cap: true }, STEEL)); } }
    // push button and its placard, stickers, flyers
    b.wrap('placard', pr(1.4) + 0.004, 1.42, PI * 0.25, 0.12, 0.17); b.box([0.1, 1.2, 0.1], [0.075, 0.12, 0.075], cGalvD, { w: [0.5, 0.4], ry: PI / 4 }); b.sph([0.132, 1.2, 0.132], 0.02, C('#b9bcbc'), STEEL);
    stickers(b, pr(1.6) + 0.003, MID ? 4 : 14, seed, 1.05, 2.3);
    return { geo: b.build(), heads, peds, armY, extra };
  };
  P.sigS = signal(5.6, 1); P.sigL = signal(8.2, 2); MID = true; P.sigSm = signal(5.6, 1).geo; P.sigLm = signal(8.2, 2).geo; MID = false;
  HH = true; P.sigSh = signal(5.6, 1); P.sigLh = signal(8.2, 2); MID = true; P.sigSmh = signal(5.6, 1).geo; P.sigLmh = signal(8.2, 2).geo; MID = false; HH = false;
  for (const [nm, L] of [['sigLodS', 5.6], ['sigLodL', 8.2]]) { const b = pb(), aY = armYof(L); b.cyl([0, 0, 0], [0, 0.95, 0], 0.26, 0.2, C('#4a4d4f'), { seg: 8, w: [0.4, 0.3] }); b.cyl([0, 0.95, 0], [0, 6.95, 0], 0.14, 0.098, cGalv, { seg: 6, w: [0.2, 0.5] });
    for (let k = 0; k < 5; k++) b.cyl([0, aY(L * k / 5), L * k / 5], [0, aY(L * (k + 1) / 5), L * (k + 1) / 5], 0.12 - 0.01 * k, 0.11 - 0.01 * k, cGalvD, { seg: 5, w: [0.2, 0.4] });
    b.cyl([0, 6.85, 0.05], [0, aY(L * 0.6) + 0.06, L * 0.6], 0.016, 0.016, cGalvD, { seg: 3, w: [0.3, 0.5] });
    for (const [x, y, z, s, yaw] of [[0.36, aY(L - 0.32) - (L > 7 ? 0.85 : 0.2), L - 0.32, 1, -0.16], [0.36, aY(L - 2.9) - 0.2, L - 2.9, 1, 0.2], (HHEAD.CW ? [0.135, 4.38, -0.44, 1, 0.1] : [0.135, 4.5, -0.44, 0.7, 0.1])]) { const h = pb(), w = 0.345 * s;
      h.box([-0.135, 0, 0], [0.27, 3 * w, w - 0.012], cHead, HP); h.box([-0.29, 0, 0], [0.03, 2.6 * w, 0.8 * w], cHeadD, HP);
      for (let k = -1; k <= 1; k++) { h.box([0.004, k * w, 0], [0.008, w * 0.8, w * 0.8], C('#0d0b06'), PLAIN); h.box([0.13, k * w + w * 0.42, 0], [0.26, 0.02, w * 0.9], cHead, HP); for (const sg of [-1, 1]) h.box([0.13, k * w + 0.1 * w, sg * w * 0.45], [0.26, w * 0.64, 0.02], cHead, HP); }
      b.merge(h, new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z)); if (s === 1) b.cyl([0, y - 0.6, z], [0, y + 0.6, z], 0.024, 0.024, cGalvD, { seg: 3, w: [0.3, 0.5] }); }
    for (const [x, z, ry] of [[0.14, -0.38, 0], [0.38, 0.14, -PI / 2]]) { const h = pb(); h.box([-0.09, 0, 0], [0.18, 0.44, 0.44], cHeadD, HP); h.box([0.004, 0, 0], [0.008, 0.36, 0.36], C('#0d0b06'), PLAIN); b.merge(h, new THREE.Matrix4().makeRotationY(ry).setPosition(x, 2.47, z)); }
    P[nm] = b.build(); }
  for (const [nm, L] of [['sigShS', 5.6], ['sigShL', 8.2]]) { const b = pb(), aY = armYof(L); b.cyl([0, 0, 0], [0, 6.9, 0], 0.07, 0.045, WHITE, { seg: 5 }); for (let k = 0; k < 4; k++) b.cyl([0, aY(L * k / 4), L * k / 4], [0, aY(L * (k + 1) / 4), L * (k + 1) / 4], 0.04 - 0.005 * k, 0.035 - 0.005 * k, WHITE, { seg: 4 });
    for (const [x, y, z, sc] of [[0.23, aY(L - 0.32) - 0.2, L - 0.32, 1], [0.23, aY(L - 2.9) - 0.2, L - 2.9, 1], [0.03, 4.5, -0.44, 0.7], [0.05, 2.47, -0.38, 0.4]]) b.box([x, y, z], [0.2, 0.96 * sc, 0.26 * sc], WHITE); P[nm] = b.build(); }
  { const b = pb(); b.cyl([0, 0, 0], [0, 8.4, 0], 0.05, 0.035, WHITE, { seg: 5 }); b.tube([[0, 8.35, 0], [0.5, 9.6, 0], [2.45, 9.76, 0]], 0.022, WHITE, { n: 5, seg: 4 }); b.box([2.8, 9.74, 0], [0.6, 0.04, 0.22], WHITE); P.lampShG = b.build(); }
  // street-name blade (cantilevered from the pole along its own street) and the one-way plate strapped below
  { const b = pb(); b.quad('blade', [0.62, 0.11, 0], 0.92, 0.2, { double: true, vary: true }); b.box([0.62, 0.222, 0], [0.96, 0.024, 0.02], cGalvD, GAL); b.box([0.62, -0.002, 0], [0.96, 0.024, 0.02], cGalvD, GAL); b.box([0.135, 0.11, 0], [0.05, 0.25, 0.03], cGalvD, GAL);
    for (const y of [0.05, 0.15]) b.cyl([0, y, 0], [0, y + 0.02, 0], 0.133, 0.132, C('#a9adac'), { w: [0.03, 0.6], seg: 10, spin: PI / 8 }); P.blade = b.build(); }
  { const b = pb(); b.quad('oneway', [0, 0.15, 0.15], 0.92, 0.3, {}); b.quad('oneway', [0, 0.15, -0.15], 0.92, 0.3, { ry: PI, ci: 1 });      // two plates, one each side of the pole: read from both directions, the pole behind each
    for (const y of [0.06, 0.24]) { b.cyl([0, y, 0], [0, y + 0.02, 0], 0.134, 0.134, C('#a9adac'), { w: [0.03, 0.6], seg: 10, spin: PI / 8 }); b.box([0, y + 0.01, 0.138], [0.05, 0.03, 0.03], C('#a9adac'), { w: [0.03, 0.6] }); } P.oneway = b.build(); }
  // the hero blocks' own signs (fine sheet A2): a blade in its cast bracket on two stainless bands, the two one-way plates, a regulation plate
  if (A2) { const alu = C('#b7bbb9'), AL = { w: [0.02, 0.55] }, stl = C('#8f9493'), ST2 = { w: [0.02, 0.5] }, bnd = C('#bcc0bf'), BND = { w: [0.02, 0.62] }, bk = C('#9da1a0'), BK = { w: [0.05, 0.5] };
    { const b = new PB(A2); b.quad('blade', [0.615, 0.115, 0], 0.92, 0.206, { double: true, vary: true, w: [0.004, 0.1], seg: 10 }); b.push(new THREE.BoxGeometry(0.925, 0.211, 0.0045, 10, 1, 1), alu, AL, b.mat([0.615, 0.115, 0]));
      for (const y of [0.0085, 0.2215]) { const eg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.923, 6, 10, true); eg.rotateZ(PI / 2); b.push(eg, alu, AL, b.mat([0.6165, y, 0])); } b.box([1.078, 0.115, 0], [0.004, 0.218, 0.011], alu, AL);
      for (const sg of [-1, 1]) { b.box([0.2, 0.115, sg * 0.006], [0.07, 0.2, 0.004], alu, AL); for (const y of [0.05, 0.18]) b.cyl([0.2, y, sg * 0.008], [0.2, y, sg * 0.013], 0.0075, 0.0075, bnd, Object.assign({ seg: 6, cap: true }, BND)); }
      b.box([0.143, 0.115, 0], [0.03, 0.235, 0.03], alu, AL); b.box([0.166, 0.115, 0], [0.045, 0.19, 0.014], alu, AL); for (const y of [0.05, 0.18]) b.cyl([0.166, y, 0.007], [0.166, y, 0.012], 0.007, 0.007, bnd, Object.assign({ seg: 6, cap: true }, BND));
      for (const y of [0.045, 0.185]) { b.cyl([0, y - 0.0095, 0], [0, y + 0.0095, 0], 0.1228, 0.1228, bnd, Object.assign({ seg: 32, spin: PI / 8 }, BND)); b.box([0.125, y, 0], [0.012, 0.024, 0.03], bnd, BND); b.box([-0.02, y, 0.1235], [0.022, 0.021, 0.005], bnd, BND); } P.hblade = b.build();
      { const Pb = P.hblade.attributes.position; for (let q = 0; q < Pb.count; q++) { const x = Pb.getX(q); if (x < 0.26) continue; const t = (x - 0.26) / 0.82; Pb.setZ(q, Pb.getZ(q) + 0.045 * t * t + 0.22 * t * (Pb.getY(q) - 0.115)); } Pb.needsUpdate = true; P.hblade.computeBoundingSphere(); P.hblade.computeBoundingBox(); } }
    { const b = new PB(A2); b.quad('oneway', [0.66, 0.15, 0.004], 0.914, 0.301, { w: [0.01, 0.1] }); b.quad('oneway', [0.66, 0.15, -0.004], 0.914, 0.301, { ry: PI, cj: 1, w: [0.01, 0.1] }); b.box([0.66, 0.15, 0], [0.918, 0.305, 0.004], alu, AL);
      b.box([0.146, 0.15, 0], [0.03, 0.31, 0.03], alu, AL); b.box([0.18, 0.15, 0], [0.05, 0.25, 0.012], alu, AL); for (const sg of [-1, 1]) for (const y of [0.07, 0.23]) b.cyl([0.225, y, sg * 0.005], [0.225, y, sg * 0.011], 0.0075, 0.0075, bnd, Object.assign({ seg: 6, cap: true }, BND));
      for (const y of [0.07, 0.23]) { b.cyl([0, y - 0.0095, 0], [0, y + 0.0095, 0], 0.129, 0.129, bnd, Object.assign({ seg: 18, spin: PI / 8 }, BND)); b.box([-0.02, y, 0.13], [0.03, 0.024, 0.008], bnd, BND); } P.honeway = b.build(); }
    { const b = new PB(A2), rp = 0.142; b.quad('park', [rp + 0.03, 0, 0], 0.305, 0.4575, { ry: PI / 2, vary: true, w: [0.01, 0.1] }); b.box([rp + 0.0275, 0, 0], [0.003, 0.4575, 0.305], bk, BK);
      for (const y of [0.15, -0.15]) { b.cyl([0, y - 0.0095, 0], [0, y + 0.0095, 0], rp - 0.004, rp - 0.004, stl, Object.assign({ seg: 12, spin: PI / 8 }, ST2)); b.box([rp + 0.012, y, 0], [0.03, 0.03, 0.05], stl, ST2); } P.hpsign = b.build(); } }
  { const z = 8.2 - 2.9, y = P.sigL.armY(z) - 0.16; const b = pb(); b.quad('park', [0.0895, y, z], 0.51, 0.76, { ry: PI / 2, ci: 5, w: [0.05, 0], rx: -0.012 }); P.armface = b.build();
    if (A2) { const h = new PB(A2); h.quad('park', [0.0895, y, z], 0.51, 0.76, { ry: PI / 2, w: [0.01, 0.1], rx: -0.012 }); P.harmface = h.build(); } }
  { const b = pb(), aY = P.sigL.armY, y = aY(3.6) - 0.03; b.quad('blade', [0.092, y, 3.6], 1.2, 0.225, { ry: PI / 2, double: true, vary: true }); b.box([0.08, y, 3.6], [0.012, 0.235, 1.21], C('#8d9190'), { w: [0.1, 0.3] });
    for (const z of [3.2, 4.0]) { b.box([0.04, aY(z), z], [0.08, 0.14, 0.035], C('#4a4d4d'), { w: [0.3, 0.4] }); b.cyl([0, aY(z), z - 0.03], [0, aY(z), z + 0.03], 0.066, 0.066, C('#4a4d4d'), { w: [0.3, 0.4], seg: 8 }); } P.armsign = b.build(); }
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
  // ---- the hero crossing's own lamp post: a cast-iron twin post (fluted shaft on a moulded pedestal, an urn and ladder bar, a ball with two scrolled arms, bell lanterns with glass globes), by hand
  { const b = pb(), cI = C('#55473c'), CI = { w: [0.06, 0.16] }, cID = C('#45382f');
    b.box([0, 0.05, 0], [0.66, 0.1, 0.66], cI, CI);
    b.lathe([[0.31, 0.1], [0.31, 0.22], [0.275, 0.27], [0.265, 0.92], [0.29, 0.96], [0.29, 1.03], [0.25, 1.07], [0.21, 1.16], [0.185, 1.34], [0.205, 1.38], [0.205, 1.45], [0.165, 1.5], [0.15, 1.62]], cI, Object.assign({ seg: 8, spin: PI / 8 }, CI));
    for (let k = 0; k < 8; k++) { const a = k * PI / 4; b.box([0.262 * Math.cos(a), 0.6, 0.262 * Math.sin(a)], [0.012, 0.5, 0.13], cID, Object.assign({ ry: -a }, CI)); }
    { const y0 = 1.62, y1 = 5.5, r0 = 0.138, r1 = 0.1, NF = 12, SD = NF * 6, NR = 6, pos = [], idx = [];       // the fluted shaft
      for (let k = 0; k <= NR; k++) { const t = k / NR, r = r0 + (r1 - r0) * t; for (let q = 0; q < SD; q++) { const a = q / SD * TAU, rr = r * (1 - 0.075 * Math.pow(0.5 + 0.5 * Math.cos(a * NF), 2)); pos.push(Math.cos(a) * rr, y0 + (y1 - y0) * t, Math.sin(a) * rr); } }
      for (let k = 0; k < NR; k++) for (let q = 0; q < SD; q++) { const a = k * SD + q, b2 = k * SD + (q + 1) % SD, c2 = a + SD, d2 = b2 + SD; idx.push(a, b2, c2, b2, d2, c2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2)); g.setIndex(idx); g.computeVertexNormals(); b.push(g, cI, CI); }
    b.lathe([[0.1, 5.5], [0.135, 5.53], [0.135, 5.59], [0.108, 5.63], [0.112, 5.8], [0.175, 5.9], [0.195, 5.97], [0.18, 6.04], [0.112, 6.09], [0.092, 6.14], [0.085, 6.3]], cI, Object.assign({ seg: 18 }, CI));
    b.cyl([-0.43, 5.72, 0], [0.43, 5.72, 0], 0.021, 0.021, cI, Object.assign({ seg: 8 }, CI)); for (const sx of [-1, 1]) b.sph([sx * 0.45, 5.72, 0], 0.036, cI, CI);
    b.cyl([0, 6.3, 0], [0, 7.28, 0], 0.085, 0.066, cI, Object.assign({ seg: 14 }, CI)); for (const y of [6.62, 6.95]) b.lathe([[0.075, y - 0.05], [0.105, y - 0.02], [0.105, y + 0.02], [0.075, y + 0.05]], cI, Object.assign({ seg: 14 }, CI));
    b.lathe([[0.066, 7.26], [0.1, 7.3], [0.085, 7.34]], cI, Object.assign({ seg: 14 }, CI)); b.sph([0, 7.5, 0], 0.175, cI, Object.assign({ seg: 16, rings: 10 }, CI)); b.cyl([0, 7.66, 0], [0, 7.74, 0], 0.03, 0.02, C('#b8672a'), { w: [0.1, 0.2], seg: 8, cap: true });
    for (const sx of [-1, 1]) {
      b.cyl([sx * 0.15, 7.5, 0], [sx * 1.12, 7.66, 0], 0.036, 0.03, cI, Object.assign({ seg: 10 }, CI)); b.cyl([sx * 0.55, 7.555, 0], [sx * 0.6, 7.565, 0], 0.048, 0.048, cI, Object.assign({ seg: 10, cap: true }, CI));
      b.tube([[sx * 0.09, 6.72, 0], [sx * 0.22, 6.95, 0], [sx * 0.42, 7.12, 0], [sx * 0.62, 7.32, 0], [sx * 0.66, 7.5, 0], [sx * 0.52, 7.52, 0], [sx * 0.46, 7.4, 0], [sx * 0.54, 7.34, 0]], 0.016, cI, Object.assign({ n: 28, seg: 6 }, CI));
      b.tube([[sx * 0.09, 6.9, 0], [sx * 0.2, 7.1, 0], [sx * 0.3, 7.3, 0], [sx * 0.24, 7.4, 0], [sx * 0.16, 7.33, 0], [sx * 0.2, 7.26, 0]], 0.013, cI, Object.assign({ n: 20, seg: 6 }, CI));
      b.sph([sx * 0.36, 7.25, 0], [0.05, 0.05, 0.022], cI, CI);
      b.box([sx * 1.12, 7.68, 0], [0.13, 0.1, 0.11], cID, CI);
      b.lathe([[0.02, 7.62], [0.07, 7.6], [0.09, 7.5], [0.12, 7.38], [0.2, 7.2], [0.245, 7.08], [0.255, 7.0], [0.262, 6.99]], cI, Object.assign({ seg: 18, at: [sx * 1.12, 0, 0] }, CI));
      b.lathe([[0.262, 6.99], [0.262, 6.95], [0.25, 6.86], [0.2, 6.72], [0.11, 6.62], [0.0, 6.6]], C('#9aa08f'), { w: [0.0, 0.05], seg: 18, at: [sx * 1.12, 0, 0] });
      b.lathe([[0.266, 7.0], [0.268, 6.97], [0.264, 6.94]], cID, Object.assign({ seg: 18, at: [sx * 1.12, 0, 0] }, CI)); }
    P.twin = b.build(); }
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
// Roads.inLane (geo.js) for margins up to maxMargin, answering from a grid of the road edges instead of walking all of them: the same test on the same
// edges (an edge is listed in every cell its box, grown by half its roadway + maxMargin, touches, so no edge the full walk would accept is missed).
// A larger margin, or roads without edge lines, goes to roads.inLane itself. (The same helper is in storefronts.js.)
function laneIndex(roads, maxMargin, cell = 32) {
  const grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const e of roads.edges) {
    if (!e.line || !e.pts) return (x, y, m) => roads.inLane(x, y, m);
    const b = e.box || (e.box = e.pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [1e9, 1e9, -1e9, -1e9]));
    const pad = (e.lanes * e.lw) / 2 + maxMargin;
    for (let i = Math.floor((b[0] - pad) / cell); i <= Math.floor((b[2] + pad) / cell); i++) for (let j = Math.floor((b[1] - pad) / cell); j <= Math.floor((b[3] + pad) / cell); j++) { const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(e); }
  }
  return (x, y, margin = 0) => {
    if (!(margin <= maxMargin)) return roads.inLane(x, y, margin);
    const a = grid.get(key(Math.floor(x / cell), Math.floor(y / cell))); if (!a) return false;
    for (const e of a) { const b = e.box, half = (e.lanes * e.lw) / 2 + margin; if (x < b[0] - half || x > b[2] + half || y < b[1] - half || y > b[3] + half) continue;
      if (!within(e.pts, x, y, half + 0.001)) continue;      // clearly farther than half from the centre line (a street's box is mostly not street: the grid runs 29 degrees off the axes): inLane says no without the full projection
      const pr = e.line.project(x, y); if (pr.d < half && pr.s > 0.5 && pr.s < e.len - 0.5) return true; }
    return false;
  };
}
// is (x, y) nearer than lim to the polyline p? (a plain distance test, used only to skip edges; the yes or no of a lane stays with Polyline.project)
function within(p, x, y, lim) {
  const l2 = lim * lim;
  for (let i = 1; i < p.length; i++) { const ax = p[i - 1][0], ay = p[i - 1][1], dx = p[i][0] - ax, dy = p[i][1] - ay; let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1e-9); t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = x - ax - dx * t, qy = y - ay - dy * t; if (qx * qx + qy * qy < l2) return true; }
  return false;
}

export async function add(game, ctx) {
  const city = game.city, world = game.world, shared = world.shared, statics = game.statics, roads = game.roads, AS = ctx.A + 'furniture/';
  const group = new THREE.Group(); group.name = 'st_furniture';
  const SW = 0.15, meta = city.meta, playable = (x, y) => Math.abs(x) < meta.px + 8 && Math.abs(y) < meta.py + 8;

  // ---- street names at the signalled crossings -> blade cells
  const sigs = city.props.signal || [], names = [], nameIx = new Map();
  for (const p of sigs) for (const k of city.nodes[p[4]].e) { const n = city.edges[k].name; if (n && !nameIx.has(n) && names.length < 160) { nameIx.set(n, names.length); names.push(shortName(n)); } }
  if (!names.length) names.push('Broadway');
  await loadWear(AS);
  if (!(game.P && game.P.get && game.P.get('hh') === '0')) await loadHHead(AS, game.P && game.P.get && game.P.get('hp') === '1' ? { k: parseFloat(game.P.get('hpk') || '0.8'), r: parseFloat(game.P.get('hpr') || '0.45') } : null);
  const HHOK = HHEAD.ok;
  const heroNames = []; for (const p of sigs.slice().sort((a, b) => Math.hypot(a[0] + 213, a[1] + 352) - Math.hypot(b[0] + 213, b[1] + 352))) if (Math.hypot(p[0] + 225, p[1] + 380) < 230) for (const k of city.nodes[p[4]].e) { const n = city.edges[k].name; if (n && !heroNames.includes(shortName(n)) && heroNames.length < 4) heroNames.push(shortName(n)); }
  const A = makeAtlas(names), A2 = makeHeroSheet(heroNames), P = buildProtos(A, A2), BC = A.cells.blade.cols;
  const fMat = patch(new THREE.MeshStandardMaterial({ map: A.tex, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4 }), shared, 'f'); fMat.shadowSide = THREE.DoubleSide;
  const hMat = patch(new THREE.MeshStandardMaterial({ map: A2.tex, vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4 }), shared, 'f'); hMat.shadowSide = THREE.DoubleSide;      // the hero blocks' signs, from the fine sheet
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2323, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const netMat = patch(new THREE.MeshStandardMaterial({ map: A.tex, vertexColors: true, roughness: 0.95, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), shared, 'f');

  // ---- kinds and placements
  const kinds = {};
  const def = (name, parts, o = {}) => { kinds[name] = Object.assign({ parts: Array.isArray(parts) ? parts : [{ geometry: parts, material: fMat }], far: 400, near: 0, shadow: true, list: [] }, o); };
  // a soft dark patch under things that stand on the ground (the sun shadow map is too coarse for chair legs and bin feet)
  const BLOB = { ptable: 0.55, pchair: 0.4, planter3: 1.05, urn0: 0.85, urn1: 0.85, urn2: 0.85, basket: 0.62, basketFull: 0.62, planter0: 1.05, planter1: 1.05, planter2: 1.05, newsbox: 0.42, hydrant: 0.34, meter: 0.3, pbin: 0.42, can: 0.42, canRust: 0.42, cart: [1.25, 0.8], bike: [0.95, 0.28], bikeB: [0.95, 0.3], bikeShare: [0.95, 0.3],
    pchairL: 0, cbox: 0.4, crate: 0.4, ubox: 0.5, kiosk: [0.4, 0.7], block: [0.9, 0.6], bag: 0.45, chalk: 0.5, barrier: [1.0, 0.45], cone: 0.26, spost: 0.16, busstop: 0.18, bench: [1.1, 0.5], cbflat: [0.6, 0.45] };
  const BINT = [C('#2c3d34'), C('#263830'), C('#5d6163'), C('#6f7375'), C('#232526')];
  let frameSolid = null;      // set below, once the collision helpers exist: bikes and racks are solid along their frames (public feedback Nov 12: "Bikes dont have collision")
  const put = (name, x, y, z, h, o) => { const K = kinds[name]; if (!K) return; if (frameSolid && (name === 'bike' || name === 'bikeB' || name === 'bikeShare' || name === 'rack')) { const fq = frameSolid(name, x, y, h); if (!fq) return; x = fq[0]; y = fq[1]; } if ((name === 'basket' || name === 'basketFull') && !(o && o.tint)) o = Object.assign({ tilt: [(hsh(x, y, 71) - 0.5) * 0.09, (hsh(x, y, 72) - 0.5) * 0.09], s: 0.9 + 0.16 * hsh(x, y, 73) }, o, { tint: BINT[Math.floor(hsh(Math.round(x / 60), Math.round(y / 60), 74) * 2.99) + (hsh(x, y, 75) < 0.07 ? 2 : 0)] }); K.list.push([x, y, z, h, o || null]); const B = BLOB[name]; if (name === 'ptable' || name === 'pchair') put(name + 'L', x, y, z, h, o);  if (name === 'lampA' || name === 'lampS') put('lampSh', x, y, z, h, { s: name === 'lampA' ? 1 : 0.88 }); if (name === 'bike' || name === 'bikeB') { put('bikeL', x, y, z, h, o); put('bikeM', x, y, z, h, o); } if (name === 'basket' || name === 'basketFull') put('basketL', x, y, z, h, o); if (name === 'planter0' || name === 'planter1' || name === 'planter2' || name === 'planter3') put('planterL', x, y, z, h, o); if (name === 'urn0' || name === 'urn1' || name === 'urn2') put('urnL', x, y, z, h, o);
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
    def('sigSm', P.sigSm, { near: 45, far: 150, fam: 'sticker', shadow: false }); def('sigLm', P.sigLm, { near: 45, far: 150, fam: 'sticker', shadow: false });
    def('sigSmh', P.sigSmh, { near: 45, far: 130, fam: 'sticker', shadow: false }); def('sigLmh', P.sigLmh, { near: 45, far: 130, fam: 'sticker', shadow: false });
    def('sigS', P.sigS.geo, { far: 150, fam: 'sticker', shadow: false }); def('sigL', P.sigL.geo, { far: 150, fam: 'sticker', shadow: false }); def('sigSc', P.sigS.geo, { far: 150, fam: 'sticker' }); def('sigLc', P.sigL.geo, { far: 150, fam: 'sticker' }); def('sigSh', P.sigSh.geo, { far: 45, fam: 'sticker' }); def('sigLh', P.sigLh.geo, { far: 45, fam: 'sticker' });
    if (HHOK) { const HG = HHEAD.pgeo ? [{ geometry: HHEAD.pgeo, material: HHEAD.pmatP }] : (HHEAD.well ? [{ geometry: HHEAD.geo, material: HHEAD.mat }, { geometry: HHEAD.well, material: HHEAD.wmat }, { geometry: HHEAD.glass, material: HHEAD.glmat }] : [{ geometry: HHEAD.geo, material: HHEAD.mat }, { geometry: HHEAD.lens, material: HHEAD.lmat }]).concat(HHEAD.visor ? [{ geometry: HHEAD.visor, material: HHEAD.vmat }] : []); const HNEAR = HHEAD.CW ? 26 : 45; def('hhead', HG, { far: HNEAR, shadow: false }); def('hheadT', HG.concat([{ geometry: HHEAD.hang, material: HHEAD.hmat || HHEAD.mat }]), { far: HNEAR, shadow: false }); if (HHEAD.CW) def('hheadL', [{ geometry: HHEAD.low, material: HHEAD.mat }, { geometry: HHEAD.lens, material: HHEAD.lmat }], { near: HNEAR, far: 130, shadow: false }); def('hpole', [{ geometry: HHEAD.pole, material: HHEAD.pmat }], { far: 45, shadow: false }); if (HHEAD.ped) def('hped', [{ geometry: HHEAD.ped.geo, material: HHEAD.ped.mat }], { far: 45, shadow: false });
      if (HHEAD.sign) { const g = HHEAD.sign.face, Pp = g.attributes.position, Nn = g.attributes.normal, fc = A2.cells.blade, a = new Float32Array(Pp.count * 2); for (let q = 0; q < Pp.count; q++) { let u = (Pp.getX(q) - 0.165) / 0.92; if (Nn.getZ(q) < 0) u = 1 - u; const v = (Pp.getY(q) - 0.012) / 0.206; a[q * 2] = fc.u0 + u * (fc.u1 - fc.u0); a[q * 2 + 1] = fc.v0 + v * (fc.v1 - fc.v0); }
        g.setAttribute('uvl', new THREE.BufferAttribute(a, 2)); HHEAD.sign.fmat.map = A2.tex; def('hsign', [{ geometry: HHEAD.sign.hw, material: HHEAD.sign.mat }, { geometry: HHEAD.sign.face, material: HHEAD.sign.fmat }], { far: 180, shadow: false }); } }
  const shMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }); shMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n gl_Position = vec4(2.0, 2.0, 2.0, 1.0);'); }; shMat.customProgramCacheKey = () => 'stfurnsh1';
  def('sigShS', [{ geometry: P.sigShS, material: shMat }], { far: 150 }); def('sigShL', [{ geometry: P.sigShL, material: shMat }], { far: 150 }); def('lampSh', [{ geometry: P.lampShG, material: shMat }], { far: 150 });
  const SHP = { planter0: 'planterL', planter1: 'planterL', planter2: 'planterL', planter3: 'planterL', urn0: 'urnL', urn1: 'urnL', urn2: 'urnL', bike: 'bikeL', bikeB: 'bikeL', basket: 'basketL', basketFull: 'basketL' };
  for (const g of ['planterL', 'urnL', 'bikeL', 'basketL']) def('sh_' + g, [{ geometry: P[g], material: shMat }], { far: 60, scale: g === 'basketL' ? 0.74 : 0.84 }); def('sigLodS', P.sigLodS, { near: 150, far: 650, shadow: false }); def('sigLodL', P.sigLodL, { near: 150, far: 650, shadow: false });
  def('hblade', [{ geometry: P.hblade, material: hMat }], { far: 260, shadow: false, fam: 'blade', atlas: A2 }); def('honeway', [{ geometry: P.honeway, material: hMat }], { far: 260, shadow: false }); def('hpsign', [{ geometry: P.hpsign, material: hMat }], { far: 220, shadow: false, fam: 'park', atlas: A2 });
  def('armface', P.armface, { far: 200, shadow: false }); def('harmface', [{ geometry: P.harmface, material: hMat }], { far: 200, shadow: false });
  def('blade', P.blade, { far: 260, shadow: false, fam: 'blade' }); def('armsign', P.armsign, { far: 300, shadow: false, fam: 'blade' }); def('oneway', P.oneway, { far: 260, shadow: false }); def('cab', P.cab, { far: 260, shadow: false });
  def('twin', P.twin, { far: 400 });
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
  const laneNear = roads && roads.inLane ? laneIndex(roads, 2) : () => false;      // load time (Nov 12): roads.inLane's own test, on the edges near the point only (laneIndex above); same answers
  const free = (x, y, r) => playable(x, y) && !occ.hit(x, y, r) && statics.onSidewalk(x, y) && !laneNear(x, y, r + 0.25) && !bldAt(x, y) && !onGrate(x, y, Math.min(0.35, r * 0.5));
  let SOLID = true;                       // switched off where only the planters and blocks may stop a car (shared streets)
  // Nov 11 (public game; a player: "npcs can drive through this area but i cant"): nothing of this file is solid inside a lane traffic uses (lane width + the circle + 0.25 m)
  const laneClear = (x, y, r) => !laneNear(x, y, r + 0.25) && !(Math.hypot(x + 231.6, y + 483.9) < 1 || Math.hypot(x + 126.1, y - 369.5) < 1);      /* lead, Nov 12: two pieces stand in Broadway's carriageway where two edges join (inLane misses the joint): not solid until the item moves them */
  const take = (x, y, r, solid) => { occ.add(x, y, r); if (solid && SOLID && laneClear(x, y, solid)) statics.addCircle(x, y, solid, 'furniture'); };
  const circles = { n: 0, lane: 0 }; const solid = (x, y, r) => { if (!SOLID) return; if (!laneClear(x, y, r)) { circles.lane++; return; } statics.addCircle(x, y, r, 'furniture'); circles.n++; };
  // a heavy piece (planter, urn, granite block) is never drawn where it cannot be solid: it moves to the nearest point clear of the lanes (up to 3 m off, 16 directions), or is not placed
  const seated = { moved: 0, dropped: 0 }; const bikeSeat = { n: 0, moved: 0, dropped: 0 };
  const seat = (x, y, r, okAt) => { if (laneClear(x, y, r)) return [x, y]; for (let d = 0.25; d <= 3.01; d += 0.25) for (let k = 0; k < 16; k++) { const a = k * PI / 8, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; if (laneClear(px, py, r) && (!okAt || okAt(px, py))) { seated.moved++; return [px, py]; } } seated.dropped++; return null; };
  frameSolid = (name, x, y, h) => { const rk = name === 'rack', q = seat(x, y, rk ? 0.45 : 0.75, (px, py) => statics.onSidewalk(px, py)); bikeSeat.n++; if (!q) { bikeSeat.dropped++; return null; } if (q[0] !== x || q[1] !== y) bikeSeat.moved++;      // a bike or rack that would stand in a traffic lane is moved to the nearest clear sidewalk point, or not placed (as planters and blocks are); none is drawn in a lane
    if (SOLID) { const c = Math.cos(h), sn = Math.sin(h), d = rk ? 0.3 : 0.44, r = rk ? 0.14 : 0.28; for (const sg of [-1, 1]) solid(q[0] + c * d * sg, q[1] + sn * d * sg, r); } return q; };      // two circles along the frame (the model's long axis is its x); a bike knocked loose by a car drops them (props.js clears the circles under a loose prop)
  const post = (x, y, r) => { if (laneClear(x, y, r)) { statics.addCircle(x, y, r, 'furniture'); circles.n++; } };      // a thin post: solid wherever it stands clear of traffic, also on shared streets
  const TINTS = { news: [C('#b3261e'), C('#1f4f9a'), C('#d8b21c'), C('#2c6b3f'), C('#d9d8d0'), C('#e06a1c')], bike: [C('#141516'), C('#141516'), C('#2a2c2f'), C('#5d6063'), C('#8a8d8f'), C('#3a1614'), C('#14263a'), C('#1f3324'), C('#7a6a3a'), C('#a8aaa6')],
    umb: [C('#5f7426'), C('#8f2a22'), C('#b9b09a'), C('#23485a'), C('#c9c6bc')], net: [C('#0b0b0c'), C('#0b0b0c'), C('#123a22'), C('#c9521a'), C('#1c3a6a')], pbin: [C('#151617'), C('#1c3f6e'), C('#1f4a30')] };
  const pick = (a, r) => a[Math.min(a.length - 1, Math.floor(r * a.length))];
  const scrapAt = (x, y, seed) => put('scrap', x, y, SW, hsh(seed, 1) * TAU, { s: 0.8 + hsh(seed, 2) * 0.7 });

  // ================================================================= signals
  const ledTex = {}; for (const [k, cs] of [['r', ['#ff1402', '#fb1002', '#e60c02', '#8c0602']], ['y', ['#ffb418', '#ffae10', '#f49a08', '#9a5600']], ['g', ['#04f868', '#04f260', '#02d44c', '#005c26']]]) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), gr = g.createRadialGradient(256, 240, 12, 256, 256, 256);
    gr.addColorStop(0, cs[0]); gr.addColorStop(0.4, cs[1]); gr.addColorStop(0.8, cs[2]); gr.addColorStop(0.97, cs[3]); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    { const sh = g.createLinearGradient(0, 0, 0, 512); sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(0.3, 'rgba(0,0,0,0.12)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); g.fillStyle = sh; g.fillRect(0, 0, 512, 512); }      // the upper part of the lens sits deeper in its visor
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, 512, 512);      // the LED array: one bright core per diode (15 px = 8.8 mm apart, rows staggered), the ground between them darker
    for (let j = 0, y = 9; y < 512; y += 18, j++) for (let x = j % 2 ? 19.5 : 9; x < 512; x += 21) { if (Math.hypot(x - 256, y - 256) > 246) continue; g.globalAlpha = 0.55 + 0.45 * hsh(x, y, k.charCodeAt(0)); const dg = g.createRadialGradient(x, y, 1, x, y, 8.5); dg.addColorStop(0, cs[0]); dg.addColorStop(0.5, cs[0]); dg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = dg; g.beginPath(); g.arc(x, y, 8.5, 0, 6.2832); g.fill(); } g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ledTex[k] = t;
    if (typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512); g.drawImage(im, 0, 0, 512, 512); t.needsUpdate = true; }; im.src = ctx.A + 'furniture/hhead/led_' + k + '.webp'; } }      /* r53: a photographed lit LED lens (credits: hhead/SOURCES.md); the drawn array above stays as the fallback */
  const ledMat = (m) => { m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLedC; varying float vLedN;').replace('#include <project_vertex>', `#include <project_vertex>
        { mat4 lm = modelMatrix; 
          #ifdef USE_INSTANCING
          lm = modelMatrix * instanceMatrix;
          #endif
          vec3 lax = normalize((lm * vec4(1.0, 0.0, 0.0, 0.0)).xyz); vec3 lwp = (lm * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vec3 lvp = (lm * vec4(position, 1.0)).xyz; vec3 lvd = normalize(cameraPosition - lvp); vLedC = dot(lax, normalize(cameraPosition - lwp)); vLedN = dot(normalize(mat3(lm) * normal), lvd); }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLedC; varying float vLedN;').replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= mix(0.012, 1.0, smoothstep(0.52, 0.9, vLedC)) * mix(0.07, 1.0, pow(clamp(vLedN, 0.0, 1.0), 4.0)) * (1.0 + 1.8 * smoothstep(0.6, 0.9, sampledDiffuseColor.r + sampledDiffuseColor.g + sampledDiffuseColor.b - max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b)) - min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b)))) * mix(0.7, 1.5, pow(smoothstep(0.6, 0.0, distance(vMapUv, vec2(0.5, 0.5))), 1.6));`); };
    m.customProgramCacheKey = () => 'stled8'; return m; };
  const HL = !!HHEAD.HL, LC2 = { r: [1.45, 0.034, 0.028], y: [1.5, 0.60, 0.02], g: [0.02, 1.3, 0.52] };
  if (HL) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#6e6e6e'; g.fillRect(0, 0, 512, 512);      // r58: one grey diode array for the three colours: a bright core per diode on a lit ground, a dark rim where the module meets its gasket
    for (let j = 0, y = 9; y < 512; y += 18, j++) for (let x = j % 2 ? 19.5 : 9; x < 512; x += 21) { if (Math.hypot(x - 256, y - 256) > 240) continue; g.globalAlpha = 0.6 + 0.4 * hsh(x, y, 77); const dg = g.createRadialGradient(x, y, 1, x, y, 8); dg.addColorStop(0, '#ffffff'); dg.addColorStop(0.45, '#ffffff'); dg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = dg; g.beginPath(); g.arc(x, y, 8, 0, 6.2832); g.fill(); } g.globalAlpha = 1;
    { const rg = g.createRadialGradient(256, 256, 226, 256, 256, 256); rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.7, 'rgba(0,0,0,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0.92)'); g.fillStyle = rg; g.fillRect(0, 0, 512, 512); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; ledTex.w = t; }
  const ledMat2 = (m) => { m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLedC;').replace('#include <project_vertex>', `#include <project_vertex>
        { mat4 lm = modelMatrix;
          #ifdef USE_INSTANCING
          lm = modelMatrix * instanceMatrix;
          #endif
          vec3 lax = normalize((lm * vec4(1.0, 0.0, 0.0, 0.0)).xyz); vec3 lwp = (lm * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vLedC = dot(lax, normalize(cameraPosition - lwp)); }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLedC;').replace('#include <map_fragment>', `#include <map_fragment>
        { vec2 lq = (vMapUv - 0.5) * 2.0; float lr = length(lq); float lt = sampledDiffuseColor.g;                          // 0.16 between diodes, 1 on a diode
          float blot = 0.78 + 0.22 * sin(lq.x * 5.3 + 1.7 * sin(lq.y * 4.1 + 0.6)) * sin(lq.y * 6.7 + 1.3 * sin(lq.x * 3.3)) + 0.16 * sin(lq.x * 13.0 + lq.y * 9.0);   // diode strings age unevenly
          float side = 1.0 + 0.45 * (lq.x * 0.8 - lq.y * 0.6) * (1.0 - vLedC);                                                // off axis the near side of the array is the brighter
          float beam = mix(0.10, 1.0, smoothstep(0.25, 0.86, vLedC));
          float rim = mix(1.0, 0.55, smoothstep(0.55, 1.0, lr));
          vec3 lc = diffuseColor.rgb / max(lt, 0.01);                                                                        // the lamp colour without the map
          diffuseColor.rgb = lc * (0.20 + 1.0 * lt) * blot * side * beam * rim + vec3(${HHEAD.HL3 ? '3.2, 1.5, 0.9' : '0.30, 0.26, 0.22'}) * pow(lt, 4.0) * blot * beam * smoothstep(1.0, 0.2, lr)${HHEAD.HL3 ? ' + (lc * 1.6 + vec3(max(lc.r, max(lc.g, lc.b))) * 0.3) * exp(-dot(lq - vec2(0.12, 0.1), lq - vec2(0.12, 0.1)) * 5.0) * beam * (0.55 + 0.45 * lt)' : ''}; }`); };
    m.customProgramCacheKey = () => 'stled11' + (HHEAD.HL3 ? 'c' : ''); return m; };
  const litGeo = domeGeo(0.128), LMUL = { r: HHEAD.pgeo ? 2.2 : 3.6, y: 2.6, g: 2.7 };
  const LCOL = { r: [2.5, 0.09, 0.05], y: [2.4, 1.25, 0.07], g: [0.02, 1.9, 0.22] };
  const L = game.sigLamps, lampFix = [], sigKind = [], hbase = { r: [], y: [], g: [] };
  const pedSlots = [];                        // [matrix, slot 0 = A (walks on green), 1 = B (walks on red)] per signal
  const HERO = (x, y) => Math.hypot(x + 225, y + 380) < 230, dropSig = new Set();
  // a hero street-name blade: the Blender-built assembly when it loaded (its baked sun only where a baked heading is within 14 degrees), else the modelled one
  const HB = (x, y, z, h, hi) => { if (!(HHOK && HHEAD.sign)) return put('hblade', x, y, z, h, { cell: [0, hi] }); const wy = ((h * 180 / PI) % 360 + 360) % 360; let ch = 9, bd = 14; HHEAD.sign.yaws.forEach((yv, ix) => { const dd = Math.abs(((wy - yv + 540) % 360) - 180); if (dd < bd) { bd = dd; ch = ix; } }); put('hsign', x, y, z, h, { cell: [0, hi], sun: ch }); };
  { const order = sigs.map((p, i) => i).filter((i) => HERO(sigs[i][0], sigs[i][1])).sort((a, b) => (sigs[b][5] - sigs[a][5]) || (a - b)), kept = [];
    for (const i of order) { const p = sigs[i]; if (kept.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 21)) dropSig.add(i); else kept.push(p); } }
  sigs.forEach((p, i) => {
    if (dropSig.has(i)) { if (L && L.base) for (const k of ['r', 'y', 'g']) for (let j = 0; j < 3; j++) L.base[k][i * 3 + j] = new THREE.Matrix4().makeScale(0, 0, 0); pedSlots.push([new THREE.Matrix4().makeScale(0, 0, 0), new THREE.Matrix4().makeScale(0, 0, 0)]); return; }
    const th = p[2] + (p[6] || 0), y0 = p[7] || SW, node = city.nodes[p[4]]; let width = p[5] ? 17.8 : 9.6, apName = null; const streets = new Map();
    for (const k of node.e) { const e = city.edges[k]; if (e.b === p[4] || e.a === p[4]) { const pts = e.b === p[4] ? e.pts : e.pts.slice().reverse(), a = pts[pts.length - 2], b = pts[pts.length - 1]; if (Math.abs(angDiff(Math.atan2(b[1] - a[1], b[0] - a[0]), p[2])) < 0.35) { width = e.width; apName = e.name; } }
      if (e.name && !streets.has(e.name)) { const q = e.pts, near0 = Math.hypot(q[0][0] - node.p[0], q[0][1] - node.p[1]) < Math.hypot(q[q.length - 1][0] - node.p[0], q[q.length - 1][1] - node.p[1]), a = near0 ? q[0] : q[q.length - 2], b = near0 ? q[1] : q[q.length - 1]; streets.set(e.name, [Math.atan2(b[1] - a[1], b[0] - a[0]), e.oneway]); } }
    const long = width >= 14, hero = HHOK && (HHEAD.CW || Math.hypot(p[0] + 222, p[1] + 364) < 80), K = sigKind[i] = hero ? (long ? P.sigLh : P.sigSh) : long ? P.sigL : P.sigS, r = hsh(p[0], p[1], 1);
    const castsOwn = Math.hypot(p[0] + 222, p[1] + 364) < 80 && !(game.P && game.P.get && game.P.get('fsh') === '0'); put((long ? 'sigL' : 'sigS') + (hero ? 'h' : castsOwn ? 'c' : ''), p[0], p[1], y0, th, { cell: [Math.floor(r * 5), Math.floor(hsh(p[0], p[1], 2) * 3)] });
    if (hero) put('hpole', p[0], p[1], y0, th);
    if (hero && HHEAD.ped) for (const o of K.peds) { const c = Math.cos(th), sn = Math.sin(th), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th + o.ry), wy = (((th + o.ry) * 180 / PI) % 360 + 360) % 360; let ch = 0, bd = 1e9; HHEAD.ped.yaws.forEach((yv, ix) => { const dd = Math.abs(((wy - yv + 540) % 360) - 180); if (dd < bd) { bd = dd; ch = ix; } });
      put('hped', p[0] + o.x * c + o.z * sn, p[1] + o.x * sn - o.z * c, y0 + o.y, 0, { q, sun: ch }); }
    if (hero) for (const o of K.heads) { const c = Math.cos(th), sn = Math.sin(th), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), th).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(o.tx || 0, o.yaw, o.tz || 0, 'YXZ'))), wy = (((th + o.yaw) * 180 / PI) % 360 + 360) % 360; let ch = 0, bd = 1e9; HHEAD.yaws.forEach((yv, ix) => { const dd = Math.abs(((wy - yv + 540) % 360) - 180); if (dd < bd) { bd = dd; ch = ix; } });
      put(o.tip ? 'hheadT' : 'hhead', p[0] + o.x * c + o.z * sn, p[1] + o.x * sn - o.z * c, y0 + o.y, 0, { q, s: o.s, sun: ch }); if (HHEAD.CW) put('hheadL', p[0] + o.x * c + o.z * sn, p[1] + o.x * sn - o.z * c, y0 + o.y, 0, { q, s: o.s, sun: ch }); }
    put((long ? 'sigLm' : 'sigSm') + (hero ? 'h' : ''), p[0], p[1], y0, th, { cell: [Math.floor(r * 5), Math.floor(hsh(p[0], p[1], 2) * 3)] }); put(long ? 'sigShL' : 'sigShS', p[0], p[1], y0, th); put(long ? 'sigLodL' : 'sigLodS', p[0], p[1], y0, th);
    if (long) put(HERO(p[0], p[1]) ? 'harmface' : 'armface', p[0], p[1], y0, th);
    let bi = 0, oi = 0;
    for (const [name, [ang, ow]] of [...streets.entries()].sort().slice(0, 2)) { const ci = nameIx.get(name); const hi = HERO(p[0], p[1]) ? heroNames.indexOf(shortName(name)) : -1; if (hi >= 0) HB(p[0], p[1], y0 + 3.62 + 0.3 * bi++, ang + (hsh(p[0], bi, 5) < 0.5 ? PI : 0), hi); else if (ci !== undefined) put('blade', p[0], p[1], y0 + 3.62 + 0.3 * bi++, ang + (hsh(p[0], bi, 5) < 0.5 ? PI : 0), { cell: [ci % BC, Math.floor(ci / BC)] }); if (ow) put(HERO(p[0], p[1]) ? 'honeway' : 'oneway', p[0], p[1], y0 + 3.2 - 0.36 * oi++, ang); }
    if (long && !HERO(p[0], p[1])) { const cross = [...streets.keys()].sort().find((nm) => nm !== apName), ci = cross ? nameIx.get(cross) : undefined; if (ci !== undefined) put('armsign', p[0], p[1], y0, th, { cell: [ci % BC, Math.floor(ci / BC)] }); }
    if (hsh(p[0], p[1], 3) < 0.38 || HERO(p[0], p[1])) put('cab', p[0], p[1], y0, th);
    if (HERO(p[0], p[1])) { const k = Math.floor(hsh(p[0], p[1], 5) * 3.99); put('hpsign', p[0], p[1], y0 + 1.9, th + 0.25, { cell: [k % 2, Math.floor(k / 2)], tilt: [0, (hsh(p[0], p[1], 6) - 0.5) * 0.04] }); }
    else if (hsh(p[0], p[1], 4) < 0.5) put('psignP', p[0], p[1], y0 + 1.9, th + 0.25, { cell: [Math.floor(hsh(p[0], p[1], 5) * 8), 0], tilt: [0, (hsh(p[0], p[1], 6) - 0.5) * 0.06] });
    occ.add(p[0], p[1], 0.9);
    // lit lamps: the lead's three discs per signal, moved onto our lenses
    const M = new THREE.Matrix4().compose(new THREE.Vector3(p[0], y0, -p[1]), new THREE.Quaternion().setFromAxisAngle(UP, th), new THREE.Vector3().setScalar(p[3] || 1));
    if (L && L.base) for (let j = K.heads.length; j < 3; j++) for (const k of ['r', 'y', 'g']) L.base[k][i * 3 + j] = new THREE.Matrix4().makeScale(0, 0, 0);      // a lamp of the lead's with no head of ours
    if (L && L.base) K.heads.forEach((h, j) => { for (const [k, dy] of [['r', 0.345], ['y', 0], ['g', -0.345]]) { const T = headM(h).multiply(new THREE.Matrix4().makeTranslation(HHOK && HHEAD.pgeo && hero ? 0.004 + HHEAD.pmeta.shift : 0.022, dy * h.s, 0)).multiply(new THREE.Matrix4().makeScale(h.s * (HHOK && HHEAD.pgeo && hero ? HHEAD.pmeta.lens / 0.1426 : 1.06), h.s * (HHOK && HHEAD.pgeo && hero ? HHEAD.pmeta.lens / 0.1426 : 1.06), h.s * (HHOK && HHEAD.pgeo && hero ? HHEAD.pmeta.lens / 0.1426 : 1.06))); L.base[k][i * 3 + j] = new THREE.Matrix4().multiplyMatrices(M, T); } });
    if (hero && HHEAD.well) K.heads.forEach((h, j) => { for (const [k, dy] of [['r', 0.345], ['y', 0], ['g', -0.345]]) hbase[k][i * 3 + j] = new THREE.Matrix4().multiplyMatrices(M, headM(h).multiply(new THREE.Matrix4().makeTranslation(0, dy * h.s, 0)).multiply(new THREE.Matrix4().makeScale(h.s, h.s, h.s))); });
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
  if (L && L.halo) for (const k of ['r', 'y', 'g']) if (L.halo[k]) L.halo[k].visible = false;
  if (L) for (const k of ['r', 'y', 'g']) if (L[k]) L[k].visible = false;        // the lead's lamp colours bloom to white
  // lit pedestrian faces: an orange hand or a white walker, switched with the vehicle phases
  // lit lamps of the extra heads at the arm tip (the lead's lamps cover three heads a pole)
  const xl = { slots: [], n: 0 }; sigs.forEach((p, i) => { const th = p[2] + (p[6] || 0), K = sigKind[i]; xl.slots[i] = []; if (!K || !K.extra.length) return; const M = new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[7] || SW, -p[1]), new THREE.Quaternion().setFromAxisAngle(UP, th), new THREE.Vector3().setScalar(p[3] || 1));
    for (const h of K.extra) { const o = { opp: h.opp, m: {}, ix: xl.n++ }; for (const [k, dy] of [['r', 0.345], ['y', 0], ['g', -0.345]]) o.m[k] = new THREE.Matrix4().multiplyMatrices(M, headM(h).multiply(new THREE.Matrix4().makeTranslation((HHOK && HHEAD.pgeo && (K === P.sigSh || K === P.sigLh)) ? 0.004 + HHEAD.pmeta.shift : 0.022, dy, 0)).multiply(new THREE.Matrix4().makeScale(...((HHOK && HHEAD.pgeo && (K === P.sigSh || K === P.sigLh)) ? [HHEAD.pmeta.lens / 0.1426, HHEAD.pmeta.lens / 0.1426, HHEAD.pmeta.lens / 0.1426] : [1.06, 1.06, 1.06])))); xl.slots[i].push(o); } });
  const lit = {}, extras = []; { const cap = Math.max(1, sigs.length * 3 + xl.n); for (const k of ['r', 'y', 'g']) { const im = new THREE.InstancedMesh(litGeo, HL ? ledMat2(new THREE.MeshBasicMaterial({ color: new THREE.Color(LC2[k][0], LC2[k][1], LC2[k][2]), map: ledTex.w, toneMapped: false })) : ledMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(LMUL[k], LMUL[k], LMUL[k]), map: ledTex[k], toneMapped: false })), cap); im.frustumCulled = false; im.matrixAutoUpdate = false; im.count = 0; group.add(im); lit[k] = im; extras.push({ m: im, cube: true }); } }

  let hlit = null; if (HHOK && HHEAD.well) { hlit = {};      // r65: the hero heads' lit lamps: the photographed LED lens, softened as through the lens's diffuser, on a cap that sits on the recessed glass
    for (const k of ['r', 'y', 'g']) { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      if (typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { try { g.filter = 'blur(4px)'; g.drawImage(im, 0, 0, 256, 256); g.filter = 'none'; const d = g.getImageData(0, 0, 256, 256), a = d.data, ch = k === 'g' ? 0 : 1; for (let q = 0; q < a.length; q += 4) { const v = Math.round(255 * (0.60 + 0.40 * a[q + ch] / 255)); a[q] = a[q + 1] = a[q + 2] = v; a[q + 3] = 255; } g.putImageData(d, 0, 0); t.needsUpdate = true; } catch (e) { console.log('[streets] furniture: lit cap texture: ' + e.message); } }; im.src = ctx.A + 'furniture/hhead/led_' + k + '.webp'; }
      const im = new THREE.InstancedMesh(HHEAD.hcap[k], new THREE.MeshBasicMaterial({ map: t, vertexColors: true, toneMapped: false }), Math.max(1, sigs.length * 3)); im.frustumCulled = false; im.matrixAutoUpdate = false; im.count = 0; group.add(im); hlit[k] = im; extras.push({ m: im, cube: false }); } }
  const glow = {}; if (HL) { const qg = new THREE.PlaneGeometry(1, 1); for (const k of ['r', 'y', 'g']) { const gm = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Vector3(LC2[k][0], LC2[k][1] + 0.02, LC2[k][2] + 0.02) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
        vertexShader: `varying vec2 vQ; varying float vC; void main() { mat4 lm = modelMatrix * instanceMatrix; vec3 ax = normalize((lm * vec4(1.0, 0.0, 0.0, 0.0)).xyz); float sc = length((lm * vec4(0.0, 1.0, 0.0, 0.0)).xyz); vec3 wc = (lm * vec4(0.0, 0.0, 0.0, 1.0)).xyz + ax * 0.10 * sc; vC = dot(ax, normalize(cameraPosition - wc)); vQ = position.xy * 2.0; vec4 mv = viewMatrix * vec4(wc, 1.0); mv.xy += position.xy * 0.92 * sc; gl_Position = projectionMatrix * mv; if (sc < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
        fragmentShader: `uniform vec3 uCol; varying vec2 vQ; varying float vC; void main() { float r = length(vQ); float a = exp(-r * r * 5.5) * ${HHEAD.HL3 ? '0.13' : '0.022'} * smoothstep(0.35, 0.9, vC) * smoothstep(1.0, 0.8, r); gl_FragColor = vec4(uCol * a, 1.0); }` });
      const im = new THREE.InstancedMesh(qg, gm, Math.max(1, sigs.length * 3 + xl.n)); im.frustumCulled = false; im.matrixAutoUpdate = false; im.count = 0; im.renderOrder = 5; group.add(im); glow[k] = im; extras.push({ m: im, cube: false }); } }
  const spill = { n: sigs.length * 3 + xl.n };
  if (L && L.base && spill.n) { const sg = new THREE.CylinderGeometry(0.1335, 0.1425, 0.25, 20, 6, true, PI * 0.66, PI * 1.68); sg.rotateZ(-PI / 2); sg.translate(0.125, 0, 0); const P0 = sg.attributes.position, col = new Float32Array(P0.count * 3); for (let q = 0; q < P0.count; q++) { const X = Math.max(0, P0.getX(q)) / 0.13, f = 0.5 * ((X * X + 2) / Math.sqrt(X * X + 4) - X) * 2 * (0.85 + 0.15 * P0.getY(q) / 0.14) * (HHEAD.R64 || HHEAD.HG ? 0.55 * Math.exp(-X * 1.6) : 1); col[q * 3] = col[q * 3 + 1] = col[q * 3 + 2] = f; } sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of ['r', 'y', 'g']) { const c0 = LCOL[k], lk = k === 'g' ? 0.42 : k === 'y' ? 0.5 : 1, c = [c0[0] * lk, c0[1] * lk, c0[2] * lk]; const im = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0] * (HHEAD.HG ? 0.16 : HHEAD.HL3 ? 0.06 : HL ? 0.032 : 0.07), c[1] * (HHEAD.HG ? 0.16 : HHEAD.HL3 ? 0.06 : HL ? 0.032 : 0.07) + c[0] * 0.004 * (HL ? 0.2 : 1), c[2] * (HHEAD.HG ? 0.16 : HHEAD.HL3 ? 0.06 : HL ? 0.032 : 0.07) + c[0] * 0.006 * (HL ? 0.2 : 1)), vertexColors: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }), spill.n); im.frustumCulled = false; im.matrixAutoUpdate = false; const z0 = new THREE.Matrix4().makeScale(0, 0, 0); for (let q = 0; q < spill.n; q++) im.setMatrixAt(q, z0); im.count = 0; im.renderOrder = 4; group.add(im); spill[k] = im; extras.push({ m: im, cube: false }); } }
  const pedLit = { hand: null, walk: null, state: new Array(sigs.length).fill('') };
  if (sigs.length) {
    const mk = (ci) => { const b = new PB(A2); b.quad('ped', [0, 0, 0], 0.4, 0.4, { ci }); const g = b.build(); const m = new THREE.MeshBasicMaterial({ map: A2.tex, color: new THREE.Color(2.5, 2.5, 2.5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }); const im = new THREE.InstancedMesh(g, m, sigs.length * 2); im.frustumCulled = false; im.matrixAutoUpdate = false; group.add(im); extras.push({ m: im, cube: false }); return im; };
    pedLit.hand = mk(0); pedLit.walk = mk(1); const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    const upd = () => { let dirty = false; sigs.forEach((p, i) => { const st = L && L.state ? L.state[i] : 'r'; if (st === pedLit.state[i]) return; pedLit.state[i] = st; dirty = true;
        for (let j = 0; j < 2; j++) { const walk = j === 0 ? st === 'g' : st === 'r'; pedLit.walk.setMatrixAt(i * 2 + j, walk ? pedSlots[i][j] : hide); pedLit.hand.setMatrixAt(i * 2 + j, walk ? hide : pedSlots[i][j]); } });
      if (!dirty) return; pedLit.hand.instanceMatrix.needsUpdate = true; pedLit.walk.instanceMatrix.needsUpdate = true;
      for (const k of ['r', 'y', 'g']) { let n = 0, nh = 0; const add = (m, hm) => { if (!m) return; if (hm && hlit) hlit[k].setMatrixAt(nh++, hm); lit[k].setMatrixAt(n, hm && hlit ? hide : m); if (spill[k]) spill[k].setMatrixAt(n, m); if (glow[k]) glow[k].setMatrixAt(n, m); n++; };       // every face shows its true phase; only lit lamps are instances
        sigs.forEach((p, i) => { const K = sigKind[i]; if (!K || dropSig.has(i)) return; const st = pedLit.state[i] || 'r'; if (st === k && L && L.base) for (let j = 0; j < K.heads.length; j++) add(L.base[k][i * 3 + j], hbase[k][i * 3 + j]); for (const o of xl.slots[i] || []) if ((o.opp ? (st === 'r' ? 'g' : 'r') : st) === k) add(o.m[k]); });
        lit[k].count = n; lit[k].instanceMatrix.needsUpdate = true; if (hlit) { hlit[k].count = nh; hlit[k].instanceMatrix.needsUpdate = true; } if (glow[k]) { glow[k].count = n; glow[k].instanceMatrix.needsUpdate = true; } if (spill[k]) { spill[k].count = n; spill[k].instanceMatrix.needsUpdate = true; } } };
    const prevUpd = game.updateSignals; game.updateSignals = function () { prevUpd.call(this); upd(); };
    try { game.updateSignals(); } catch (e) { console.log('[streets] furniture: signal refresh: ' + e.message); }
    if (pedLit.state[0] === '') { pedLit.state.fill('x'); sigs.forEach((p, i) => { for (let j = 0; j < 2; j++) { pedLit.hand.setMatrixAt(i * 2 + j, pedSlots[i][j]); pedLit.walk.setMatrixAt(i * 2 + j, hide); } }); }
  }

  // ================================================================= street lights
  for (const p of city.props.light || []) {
    const th = p[2] - PI / 2, e = nearEdge(p[0] + Math.cos(th) * 3, p[1] + Math.sin(th) * 3), ave = !!(e && e.e.ave), r = hsh(p[0], p[1], 20);
    if (Math.hypot(p[0] + 213, p[1] + 352) < 26) {      // the hero crossing: cast-iron twin posts with the two street names on them
      put('twin', p[0], p[1], SW, th + PI / 2); post(p[0], p[1], 0.2); const g23 = Math.atan2(0.487, -0.875), gBw = Math.atan2(0.875, 0.487), hi = (re) => heroNames.findIndex((n) => re.test(n));
      const iB = hi(/Broadway/i), i23 = hi(/23/); if (iB >= 0) HB(p[0], p[1], SW + 3.55, gBw + (r < 0.5 ? PI : 0), iB); if (i23 >= 0) HB(p[0], p[1], SW + 3.22, g23 + (r < 0.5 ? 0 : PI), i23);
      occ.add(p[0], p[1], 0.8); continue; }
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
          const q = Math.floor(hsh(kx, ky, 96) * 4), st0 = q < 2 ? seat(kx + nx * 0.85, ky + ny * 0.85, 0.62, (px, py) => !bldAt(px, py) && playable(px, py) && !occ.hit(px, py, 0.8)) : [kx + nx * 0.85, ky + ny * 0.85]; if (!st0) continue; const x = st0[0], y = st0[1], Z = zAt(x, y); if (occ.hit(x, y, 0.8) || bldAt(x, y) || !playable(x, y) || laneDist(x, y) < 3.3) continue;
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
            { const [x, y] = P2(2.0); if (hsh(sdk, 9) < 0.7 && okR(x, y, 0.2)) { post(x + tx * (hsh(sdk, 10) - 0.5) * 1.4, y + ty * (hsh(sdk, 10) - 0.5) * 1.4, 0.06); put('delin', x + tx * (hsh(sdk, 10) - 0.5) * 1.4, y + ty * (hsh(sdk, 10) - 0.5) * 1.4, 0.03, sdk, { s: [1, 0.8 + 0.25 * hsh(sdk, 11), 1], tilt: [(hsh(sdk, 1) - 0.5) * 0.14, (hsh(sdk, 2) - 0.5) * 0.14] }); } }
            if (half < 4.4) continue;
            if (k % 2 === 0) { const s0 = P2(3.55 + 0.3 * hsh(sdk, 3)), st0 = seat(s0[0], s0[1], 0.62, (px, py) => okR(px, py, 0.8)), x = st0 ? st0[0] : 0, y = st0 ? st0[1] : 0; if (st0 && okR(x, y, 0.8)) { if (hsh(sdk, 4) < 0.62) { put((hsh(sdk, 12) < 0.45 ? 'planter' + Math.floor(hsh(sdk, 5) * 4) : 'urn' + (1 + Math.floor(hsh(sdk, 13) * 1.99))), x, y, 0.03, sdk, { s: 0.8 + 0.5 * hsh(sdk, 6) }); take(x, y, 0.9, 0.62); } else { put('block', x, y, 0.03, rot + (hsh(sdk, 7) - 0.5) * 0.5, { s: 0.85 + 0.3 * hsh(sdk, 6) }); take(x, y, 0.8, 0.5); } } }
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
  // frame cost (r15): furniture was +3 ms on the M2 Pro, in draw calls (about 350 meshes in range, each drawn again by the AO pass and the street cube).
  // Now: a tile size per kind chosen by cost, each instance culled to its own distance band in the vertex shader, the shadow stand-ins merged
  // into one caster mesh per 95 m tile, and only what matters drawn in the AO pass and the street cube. ?fperf=0 = as before (to measure).
  const PF = game.P && game.P.get && game.P.get('fperf') !== null ? +game.P.get('fperf') : 7, PT = !!(PF & 1), PC = !!(PF & 4), PFS = { pass: !!(PF & 2), only: (PF & 8) ? /^(sig|lamp|blade|oneway|cab|armsign|blob|shcast)/ : null },     /* ?fperf= bits: 1 tile sizes, 2 pass rules, 4 merged casters, 8 only signals and lamps (a floor to measure against) */ SAMP = [[-201, -366], [-122, -143], [40, 60], [260, -200], [-330, 240]], DRAW = 24000;
  const pickT = (K, vertsK) => { let best = 190, bc = 1e18;
    for (const T of [48, 95, 190, 380, 760, 4000]) { const tl = new Map(); for (const it of K.list) { const k = (Math.floor(it[0] / T) + 512) * 1024 + Math.floor(it[1] / T) + 512; tl.set(k, (tl.get(k) || 0) + 1); }
      let c = 0; const r = T * 0.7072; for (const [k, n] of tl) { const tx = (Math.floor(k / 1024) - 512 + 0.5) * T, ty = (k % 1024 - 512 + 0.5) * T; for (const sp of SAMP) { const d = Math.hypot(sp[0] - tx, sp[1] - ty); if (d - r < K.far && d + r >= K.near) c += DRAW + n * vertsK; } }
      if (c < bc) { bc = c; best = T; } }
    return best; };
  const NOAO = /^(blob|sunsh|sigSh|lampSh|sh_|net|hblade|honeway|hpsign|armface|harmface|blade|armsign|oneway|psign|banner|shedBoard|shedPermit|cbflat|scrap)/, CUBE = /^(sig[SL][cm]?$|sigLod|lamp[AS]$|lampLod|twin|shelter|cart|umbrella|kiosk)/;
  if (PT) { const FAR = { sigS: 45, sigL: 45, sigSc: 45, sigLc: 45, sigSh: 45, sigLh: 45, sigSm: 130, sigLm: 130, sigSmh: 130, sigLmh: 130, lampA: 110, lampS: 110, rack: 90, fence: 120, spost: 120, urnL: 120, planterL: 120, pchairL: 100, ptableL: 110, bagLod: 120, scaf: 90, shedUnder: 60, scrap: 40, bikeL: 110, net: 150, psign: 140, psignP: 140, psignL: 140, hpsign: 140,
      blade: 180, hblade: 180, armsign: 200, oneway: 180, honeway: 180, cab: 180, meter: 150, newsbox: 150, delin: 140, cone: 140, cbflat: 100, banner: 160, hydLod: 180, basketL: 120, busstop: 250, shelter: 300, kiosk: 300, umbrella: 300, umbrellaC: 300, umbrellaV1: 300, umbrellaV2: 300, cart: 300,
      block: 250, benchP: 200, aframe: 160, dock: 160, dockKiosk: 250, pbin: 160, shedBoard: 150, sigLodS: 350, sigLodL: 350, lampLod: 350 };
    for (const k in FAR) if (kinds[k]) kinds[k].far = Math.min(kinds[k].far, FAR[k]); for (const k of ['sigLodS', 'sigLodL']) kinds[k].near = 130; kinds.lampLod.near = 110; }
  else { kinds.sigSm.list.length = 0; kinds.sigLm.list.length = 0; kinds.sigSmh.list.length = 0; kinds.sigLmh.list.length = 0; }
  const meshes = []; let instances = 0, tris = 0; const M4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3();
  for (const name of Object.keys(kinds)) {
    const K = kinds[name]; if (!K.list.length) continue; const tiles = new Map(), triK = K.parts.reduce((t, q) => t + (q.geometry.index ? q.geometry.index.count : q.geometry.attributes.position.count) / 3, 0), T = PT ? pickT(K, triK * 3) : (K.list.length * triK < 80000 ? 380 : 190);      // the tile size that costs least: a draw call against the vertices of a tile drawn whole
    for (const it of K.list) { const k = Math.floor(it[0] / T) + ',' + Math.floor(it[1] / T); let a = tiles.get(k); if (!a) tiles.set(k, (a = [])); a.push(it); }
    for (const [key, items] of tiles) {
      const [ti, tj] = key.split(',').map(Number);
      for (const part of K.parts) {
        const isF = part.material === fMat || part.material === netMat || part.material === hMat, n = items.length, fc = K.fam ? (K.atlas || A).cells[K.fam] : null;
        const g = new THREE.BufferGeometry(); for (const a in part.geometry.attributes) g.setAttribute(a, part.geometry.attributes[a]); g.setIndex(part.geometry.index); g.boundingSphere = part.geometry.boundingSphere; g.boundingBox = part.geometry.boundingBox;
        const im = new THREE.InstancedMesh(g, part.material, n), tint = isF ? new Float32Array(n * 3).fill(1) : null, cell = isF ? new Float32Array(n * 2) : null;
        for (let i = 0; i < n; i++) {
          const it = items[i], o = it[4]; if (o && o.q) q4.copy(o.q); else { e4.set(o && o.tilt ? o.tilt[0] : 0, it[3], o && o.tilt ? o.tilt[1] : 0, 'YXZ'); q4.setFromEuler(e4); } v4.set(it[0], it[2], -it[1]);
          if (o && o.s !== undefined) { if (typeof o.s === 'number') s4.setScalar(o.s); else s4.set(o.s[0], o.s[1], o.s[2]); } else s4.set(1, 1, 1); if (K.scale) s4.multiplyScalar(K.scale);
          M4.compose(v4, q4, s4); im.setMatrixAt(i, M4);
          if (isF && o) { if (o.tint) tint.set(o.tint, i * 3); if (o.cell && fc) { cell[i * 2] = o.cell[0] * fc.du; cell[i * 2 + 1] = o.cell[1] * fc.dv; } }
        }
        if (isF) { g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3)); g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2)); }
        { const bd = new Float32Array(n * 2); for (let i = 0; i < n; i++) { bd[i * 2] = K.near; bd[i * 2 + 1] = K.far; } g.setAttribute('aBand', new THREE.InstancedBufferAttribute(bd, 2)); }
        if (HHOK && HHEAD.sign && part.material === HHEAD.sign.fmat) { const fc2 = A2.cells.blade, ce = new Float32Array(n * 2); for (let i = 0; i < n; i++) { const o = items[i][4]; if (o && o.cell) { ce[i * 2] = o.cell[0] * fc2.du; ce[i * 2 + 1] = o.cell[1] * fc2.dv; } } g.setAttribute('aCell', new THREE.InstancedBufferAttribute(ce, 2)); }
        if (HHOK && (part.material === HHEAD.mat || part.material === HHEAD.hmat || part.material === HHEAD.pmatP || part.material === HHEAD.lmat || (HHEAD.vmat && part.material === HHEAD.vmat) || (HHEAD.ped && part.material === HHEAD.ped.mat) || (HHEAD.sign && (part.material === HHEAD.sign.mat || part.material === HHEAD.sign.fmat)))) { const sa = new Float32Array(n); for (let i = 0; i < n; i++) sa[i] = (items[i][4] && items[i][4].sun) || 0; g.setAttribute('aSun', new THREE.InstancedBufferAttribute(sa, 1)); }
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.updateMatrix();
        im.castShadow = K.shadow && !part.noShadow; im.receiveShadow = !part.material.userData.hgNoRecv && !(HHOK && (part.material === HHEAD.mat || part.material === HHEAD.hmat || part.material === HHEAD.lmat || part.material === HHEAD.pmatP || (HHEAD.vmat && part.material === HHEAD.vmat)));      // r47: the hero head carries its own baked sun; the shadow map stippled its grazed faces ("sparkly, pebbled grain") im.name = 'st_' + name; if (part.material.transparent) im.renderOrder = 3;
        im.userData = { tiled: true, kind: 'st_' + name, far: K.far, near: K.near, cx: (ti + 0.5) * T, cz: -(tj + 0.5) * T, r: T * 0.7072, cast: im.castShadow, ao: K.near === 0 && T <= 380 && !part.material.transparent && !NOAO.test(name), cube: CUBE.test(name) && part.material !== shMat };
        group.add(im); meshes.push(im); instances += n; tris += n * (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
    }
  }
  // the shadow stand-ins of every kind as one caster mesh per 95 m tile (made once the other parts have taken their instances out)
  const tDone = performance.now(); let merged = !PC;
  const ready = () => { const rp = game.streets && game.streets.report; return !!(rp && (rp.clutter !== undefined || rp.vehicles !== undefined)) || performance.now() - tDone > 5000; };
  const AO_R = 28, CUBE_R = 60, CAST_R = 60;
  const mergeCasters = () => { merged = true; const tl = new Map(), TS = 95, v = new THREE.Vector3(), e = M4.elements;
    for (const m of meshes) { if (m.material !== shMat || !m.isInstancedMesh) continue; const P = m.geometry.attributes.position;
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, M4); if (Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]) < 1e-6) continue; const k = Math.floor(e[12] / TS) + ',' + Math.floor(-e[14] / TS); let a = tl.get(k); if (!a) tl.set(k, (a = []));
        for (let q = 0; q < P.count; q++) { v.fromBufferAttribute(P, q).applyMatrix4(M4); a.push(v.x, v.y, v.z); } }
      m.userData.off = true; m.visible = false; group.remove(m); }
    for (const [key, a] of tl) { const ij = key.split(',').map(Number), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(a), 3)); g.computeBoundingSphere();
      const me = new THREE.Mesh(g, shMat); me.castShadow = true; me.receiveShadow = false; me.matrixAutoUpdate = false; me.name = 'st_shcast';
      me.userData = { tiled: true, kind: 'st_shcast', far: CAST_R, near: 0, cx: (ij[0] + 0.5) * TS, cz: -(ij[1] + 0.5) * TS, r: TS * 0.7072, cast: false }; group.add(me); meshes.push(me); } };
  let active = meshes, actP = null; const ACT = !(PF & 16);
  const refresh = (p) => { const fixed = group.children.filter((c) => !c.userData.tiled); active = [];
    for (const m of meshes) { const u = m.userData; if (u.off) continue; const dc = Math.hypot(p.x - u.cx, p.z - u.cz); if (Math.max(0, dc - u.r) < u.far + 15 && (u.near === 0 || dc + u.r >= u.near - 15)) { active.push(m); m.parent = group; } }
    group.children = fixed.concat(active); actP = { x: p.x, z: p.z }; };
  const prev = world.scene.onBeforeRender;
  world.scene.onBeforeRender = function (renderer, scene, camera, rt) {
    if (prev) prev.call(this, renderer, scene, camera, rt);
    if (!camera.isPerspectiveCamera || !group.visible) return; const p = camera.position;
    if (!merged && ready()) { try { mergeCasters(); } catch (err) { merged = true; console.log('[streets] furniture: caster merge failed: ' + (err && err.message)); } actP = null; }
    if (ACT && merged && (!actP || (camera === world.camera && Math.hypot(p.x - actP.x, p.z - actP.z) > 10))) refresh(p);
    const PERF = PFS.pass, ONLY = PFS.only, ao = PERF && !!scene.overrideMaterial, cube = PERF && !ao && (camera.layers.mask === 8 || !!(rt && rt.isWebGLCubeRenderTarget));
    for (const e of extras) e.m.visible = ao ? false : cube ? e.cube : true;
    for (const m of active) { const u = m.userData; if (u.off) continue; if (ONLY && !ONLY.test(u.kind.slice(3))) { m.visible = false; continue; } const dc = Math.hypot(p.x - u.cx, p.z - u.cz), d = Math.max(0, dc - u.r);
      let v = d < u.far && (u.near === 0 || dc + u.r >= u.near);
      if (v && ao) v = !!u.ao && d < AO_R; else if (v && cube) v = !!u.cube && d < CUBE_R;
      m.visible = v; if (PC && u.cast && !ao && !cube) m.castShadow = d < CAST_R; }
  };
  world.scene.add(group);
  const kc = {}; for (const k in kinds) if (kinds[k].list.length) kc[k] = kinds[k].list.length;
  console.log('[streets] furniture kinds ' + JSON.stringify(kc) + ' kerb ' + JSON.stringify(counts));
  return { group, meshes, kinds, grateSpots, perf: PFS, lit, report: { instances, ktris: Math.round(tris / 1000), signals: sigs.length, lights: (city.props.light || []).length, plazaSets, fence_m: Math.round(fenceM), scafBays, shedBays, osmPlazas, shops: shopN, grates: gratesIn.length, grateRacks, shared_m: sharedM, circles: circles.n, seatMoved: seated.moved, seatDropped: seated.dropped, bikeSeat } };
}
