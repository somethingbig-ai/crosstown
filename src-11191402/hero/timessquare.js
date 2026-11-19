// hero/timessquare.js (landmarks lane, Nov 16; Matt: "what about the rest of the city"): Times Square had no signs at all, so it read as any avenue.
// This hangs lit advertising screens on every wall that looks onto the bowtie (Broadway / 7th Av, W 42nd to W 47th St) and a stack of screens on the
// north face of One Times Square. All brands are made up; the pictures are drawn here on one canvas (no asset, nothing fetched). The screens are
// unlit-bright by day and brighter at night (world.shared.uNightK.y), and the pictures change every few seconds.
// Nothing is built on a map without a building named 'One Times Square'. ?tsq=0 = off. window.__tsq for a look.
import * as THREE from 'three';

const AX = [[12, 1211], [160, 1650]];     // the bowtie's centre line, map metres (x east, y north)
const rnd = (s) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const toAxis = (x, y) => { const dx = AX[1][0] - AX[0][0], dy = AX[1][1] - AX[0][1], t = Math.max(0, Math.min(1, ((x - AX[0][0]) * dx + (y - AX[0][1]) * dy) / (dx * dx + dy * dy))), px = AX[0][0] + t * dx, py = AX[0][1] + t * dy; return { d: Math.hypot(x - px, y - py), px, py }; };

// ---- the pictures on one 2048x1024 sheet: two rows of 4 wide (512x192), a row of 8 square (256x256), a row of 8 tall (256x384). Every row is the
// full width, so stepping a row's texture sideways brings its next picture. assets/hero/tsq-ads.webp, when there, replaces the drawn sheet (same layout).
const CLASSES = [{ n: 4, w: 512, h: 192, y: 0 }, { n: 4, w: 512, h: 192, y: 192 }, { n: 8, w: 256, h: 256, y: 384 }, { n: 8, w: 256, h: 384, y: 640 }];
const SHEET = 'assets/hero/tsq-ads.webp';     // Aurora worker A2's painted sheet (rendered products, the same made-up brands); it ships with this file. ?tsqart=0 = the sheet drawn here
const classOf = (w, h, r) => (w / h > 1.7 ? (r < 0.5 ? 0 : 1) : w / h > 0.8 ? 2 : 3);
const BR = ['CROSSTOWN COLA', 'CROSSTOWN', 'VELDRIPTAL', 'VELLUMBRISQUE', 'KROVANTHIM', 'TERVOMEL', 'VESPRAX PARADE', 'TICKERWISPEN NEWS', 'DIALWISPLE FM', 'CRUSTWINKLE', 'ZARQUIPT!', 'ORVESSIL', 'HELLO NEW YORK', 'TONIGHT 8PM', 'BIG SALE', 'BUNDRIFTLE'];
const TAG = ['ice cold', 'the game', 'see the light', 'fly further', 'made to move', 'feel it', 'the musical', 'live now', '99.9', 'open late', 'in theatres', 'be seen', 'welcome', 'on stage', 'today only', 'hot & fast'];
const PAL = [['#e3120f', '#ff5a3c', '#fff'], ['#0b1a4a', '#2b6cff', '#ffe14a'], ['#ffd400', '#ff9d00', '#111'], ['#00a6a6', '#00e0c6', '#fff'], ['#111', '#333', '#ff2d87'], ['#7a1fe0', '#ff3fb4', '#fff'], ['#0e7d2d', '#7be04b', '#fff'], ['#fff', '#dfe7f5', '#e3120f'], ['#ff3d00', '#ffb300', '#fff'], ['#001018', '#00384f', '#35e2ff'], ['#f4f0e6', '#ffd9a0', '#1a1a1a'], ['#c6007e', '#ff7ac8', '#fff']];
function fit(g, s, w, px, font) { g.font = `${font} ${px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`; const m = g.measureText(s).width; if (m > w) { px = Math.floor(px * w / m); g.font = `${font} ${px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`; } return px; }
// a small picture for an ad, drawn in a box of side r centred on (cx, cy): 0 bottle, 1 burger, 2 phone, 3 pizza slice, 4 note, 5 skyline, 6 headphones, 7 play, 8 burst, 9 cup, 10 mask, 11 plane
function icon(g, n, cx, cy, r, c1, c2) {
  g.save(); g.translate(cx, cy); g.scale(r / 100, r / 100); g.fillStyle = c1; g.strokeStyle = c1; g.lineWidth = 9; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
  if (n === 0) { g.moveTo(-10, -95); g.lineTo(10, -95); g.lineTo(11, -55); g.bezierCurveTo(34, -30, 30, 10, 26, 30); g.bezierCurveTo(24, 50, 30, 70, 26, 95); g.lineTo(-26, 95); g.bezierCurveTo(-30, 70, -24, 50, -26, 30); g.bezierCurveTo(-30, 10, -34, -30, -11, -55); g.closePath(); g.fill(); g.fillStyle = c2; g.fillRect(-27, 0, 54, 30); }
  else if (n === 1) { g.arc(0, -18, 80, Math.PI, 0); g.closePath(); g.fill(); g.fillStyle = c2; g.fillRect(-84, -10, 168, 18); g.fillStyle = c1; g.fillRect(-80, 14, 160, 26); g.beginPath(); g.moveTo(-80, 48); g.lineTo(80, 48); g.quadraticCurveTo(80, 84, 50, 84); g.lineTo(-50, 84); g.quadraticCurveTo(-80, 84, -80, 48); g.fill(); }
  else if (n === 2) { g.roundRect(-46, -92, 92, 184, 16); g.fill(); g.fillStyle = c2; g.beginPath(); g.roundRect(-37, -78, 74, 150, 6); g.fill(); }
  else if (n === 3) { g.moveTo(0, 92); g.lineTo(-70, -70); g.quadraticCurveTo(0, -100, 70, -70); g.closePath(); g.fill(); g.fillStyle = c2; for (const q of [[-18, -40], [22, -30], [0, 10], [-10, 45]]) { g.beginPath(); g.arc(q[0], q[1], 13, 0, 7); g.fill(); } }
  else if (n === 4) { g.ellipse(-34, 62, 30, 22, -0.4, 0, 7); g.ellipse(50, 42, 30, 22, -0.4, 0, 7); g.fill(); g.fillRect(-12, -70, 12, 132); g.fillRect(72, -90, 12, 132); g.beginPath(); g.moveTo(-12, -70); g.lineTo(84, -92); g.lineTo(84, -62); g.lineTo(-12, -40); g.fill(); }
  else if (n === 5) { let x = -95; for (const hh of [60, 110, 80, 170, 95, 140, 70, 120]) { g.rect(x, 90 - hh, 22, hh); x += 24; } g.fill(); g.fillRect(-25, -110, 4, 30); }
  else if (n === 6) { g.lineWidth = 16; g.arc(0, 0, 72, Math.PI, 0); g.stroke(); g.beginPath(); g.roundRect(-92, -6, 36, 80, 12); g.roundRect(56, -6, 36, 80, 12); g.fill(); }
  else if (n === 7) { g.arc(0, 0, 88, 0, 7); g.fill(); g.fillStyle = c2; g.beginPath(); g.moveTo(-28, -46); g.lineTo(52, 0); g.lineTo(-28, 46); g.closePath(); g.fill(); }
  else if (n === 8) { for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12, rr = i % 2 ? 62 : 96; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); g.fillStyle = c2; g.font = '900 54px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('-50%', 0, 4); }
  else if (n === 9) { g.moveTo(-52, -60); g.lineTo(52, -60); g.lineTo(38, 92); g.lineTo(-38, 92); g.closePath(); g.fill(); g.fillRect(-60, -82, 120, 20); g.fillStyle = c2; g.fillRect(-46, -14, 92, 44); }
  else if (n === 10) { g.moveTo(-80, -60); g.quadraticCurveTo(0, -30, 80, -60); g.quadraticCurveTo(90, 40, 0, 92); g.quadraticCurveTo(-90, 40, -80, -60); g.fill(); g.fillStyle = c2; g.beginPath(); g.ellipse(-34, -18, 20, 11, 0.2, 0, 7); g.ellipse(34, -18, 20, 11, -0.2, 0, 7); g.fill(); g.beginPath(); g.arc(0, 26, 34, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = 9; g.strokeStyle = c2; g.stroke(); }
  else { g.moveTo(-96, 10); g.lineTo(90, -20); g.quadraticCurveTo(104, -8, 88, 4); g.lineTo(-10, 30); g.lineTo(-50, 80); g.lineTo(-66, 78); g.lineTo(-44, 34); g.lineTo(-86, 40); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-20, 2); g.lineTo(-48, -64); g.lineTo(-30, -66); g.lineTo(24, -6); g.fill(); }
  g.restore();
}
const ICON = [0, 5, 2, 11, 6, 8, 10, 7, 4, 3, 7, 2, 5, 10, 8, 1];     // which picture goes with which made-up brand (BR)
function ad(g, x, y, w, h, k, R) {
  const p = PAL[(k * 5 + 3) % PAL.length], bi = k % BR.length, name = BR[bi], tag = TAG[bi], style = (k * 7 + (R() * 3 | 0)) % 6, wide = w > h * 1.5; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
  const gr = g.createLinearGradient(0, 0, w * (style & 1), h); gr.addColorStop(0, p[0]); gr.addColorStop(1, p[1]); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // soft lights behind, so the panel is not a flat poster
  for (let i = 0; i < 7; i++) { const cx = R() * w, cy = R() * h, rr = (0.15 + R() * 0.35) * Math.max(w, h), rg = g.createRadialGradient(cx, cy, 0, cx, cy, rr); rg.addColorStop(0, i % 2 ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.16)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, w, h); }
  if (style === 0) { g.globalAlpha = 0.18; g.fillStyle = p[2]; for (let i = -4; i < 14; i++) { g.beginPath(); g.moveTo(i * w / 8, h); g.lineTo(i * w / 8 + w / 16, h); g.lineTo(i * w / 8 + w / 16 + h * 0.6, 0); g.lineTo(i * w / 8 + h * 0.6, 0); g.fill(); } g.globalAlpha = 1; }
  if (style === 1) { g.globalAlpha = 0.22; g.fillStyle = p[2]; const cx = w * (wide ? 0.2 : 0.5), cy = h * (wide ? 0.5 : 0.3); for (let i = 0; i < 16; i += 2) { g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, w + h, i * Math.PI / 8, (i + 1) * Math.PI / 8); g.fill(); } g.globalAlpha = 1; }
  if (style === 3) { g.fillStyle = 'rgba(0,0,0,0.30)'; g.fillRect(0, h * 0.80, w, h * 0.20); g.fillStyle = '#e3120f'; g.fillRect(w * 0.03, h * 0.83, Math.min(w * 0.22, h * 0.5), h * 0.13); g.fillStyle = '#fff'; g.font = `900 ${Math.floor(h * 0.09)}px "Arial Black", Impact, sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('LIVE', w * 0.05, h * 0.9); }
  if (style === 5) { g.strokeStyle = p[2]; g.lineWidth = Math.max(4, Math.min(w, h) * 0.03); g.strokeRect(g.lineWidth, g.lineWidth, w - 2 * g.lineWidth, h - 2 * g.lineWidth); }
  // the picture: left on a wide panel, top on a square or tall one; then the name, big, and a small line under it
  const ir = Math.min(w, h) * (wide ? 0.36 : 0.30), icx = wide ? h * 0.52 : w / 2, icy = wide ? h * 0.5 : h * (h > w * 1.2 ? 0.27 : 0.30); g.globalAlpha = 0.96; icon(g, ICON[bi], icx, icy, ir, p[2], p[0]); g.globalAlpha = 1;
  const tx = wide ? h * 1.0 + (w - h * 1.0) / 2 : w / 2, tw = wide ? (w - h * 1.05) * 0.94 : w * 0.88, ty = wide ? h * 0.44 : h * (h > w * 1.2 ? 0.66 : 0.72);
  g.fillStyle = p[2]; g.textAlign = 'center'; g.textBaseline = 'middle'; const words = (!wide && name.includes(' ')) ? name.split(' ') : [name];
  const px = Math.min(...words.map((s) => fit(g, s, tw, h * (wide ? 0.40 : words.length > 1 ? 0.13 : 0.16), '900'))); g.font = `900 ${px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = px * 0.12; words.forEach((s, i) => g.fillText(s, tx, ty + (i - (words.length - 1) / 2) * px * 1.02)); g.shadowBlur = 0;
  { const tp = fit(g, tag.toUpperCase(), tw * 0.8, Math.max(9, h * (wide ? 0.13 : 0.05)), '700'); g.font = `700 ${tp}px "Helvetica Neue", Arial, sans-serif`; g.globalAlpha = 0.92; g.fillText(tag.toUpperCase(), tx, Math.min(h * (style === 3 ? 0.74 : 0.95) - tp * 0.6, ty + words.length * px * 0.60 + tp * 0.7)); }
  g.restore();
}
function art() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const g = c.getContext('2d'), R = rnd(77); g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 1024); let k = 0;
  for (const C of CLASSES) for (let i = 0; i < C.n; i++) ad(g, i * C.w, C.y, C.w, C.h, k++, R);
  return c;
}

export function install(game) {
  const Q = new URLSearchParams(location.search), W = game.world, city = game.city; if (!W || !W.scene || !(city.buildings || []).some((b) => b.name === 'One Times Square')) return null;
  const R = rnd(4242), near = city.buildings.filter((b) => { const p = b.poly[0], a = toAxis(p[0], p[1]); return a.d < 160; });
  // 1. the walls that look onto the square: long enough, facing the centre line, no other tall building standing between. A building in parts
  //    (podium + tower) gives one wall per edge, from its lowest part's foot to its highest part's top.
  const walls = new Map();
  for (const b of near) { if (b.h < 9 || b.name === 'TKTS') continue; const P = b.poly; let ar = 0; for (let i = 0; i < P.length; i++) { const a = P[i], q = P[(i + 1) % P.length]; ar += a[0] * q[1] - q[0] * a[1]; }
    for (let i = 0; i < P.length; i++) { const a = P[i], q = P[(i + 1) % P.length], L = Math.hypot(q[0] - a[0], q[1] - a[1]); if (L < 7) continue; const mx = (a[0] + q[0]) / 2, my = (a[1] + q[1]) / 2, A = toAxis(mx, my); if (A.d > 80 || A.d < 4) continue;
      let nx = (q[1] - a[1]) / L, ny = -(q[0] - a[0]) / L; if (ar < 0) { nx = -nx; ny = -ny; } const fx = (A.px - mx) / A.d, fy = (A.py - my) / A.d; if (nx * fx + ny * fy < 0.25) continue;
      let clear = true; for (let s = 2; s < A.d - 1 && clear; s += 3) { const x = mx + nx * s, y = my + ny * s; for (const o of near) if (o !== b && o.h > 12 && (+o.minh || 0) < 6 && o.name !== 'TKTS' && !(b.name && o.name === b.name) && inPoly(x, y, o.poly)) { clear = false; break; } } if (!clear) continue;
      const key = Math.round(mx / 3) + ':' + Math.round(my / 3), w = walls.get(key), lo = +b.minh || 0; if (!w) walls.set(key, { a, q, L, nx, ny, lo, h: b.h, d: A.d }); else { w.lo = Math.min(w.lo, lo); w.h = Math.max(w.h, b.h); } } }
  // 2. the signs on each wall: columns along it, stacked edge to edge from just above the shop fronts; a low building carries them up past its roof
  const signs = [], put = (ax, ay, ux, uy, nx, ny, s0, w, y0, h) => { const cls = classOf(w, h, R()); signs.push({ ax, ay, ux, uy, nx, ny, s0, w, y0, h, cls, cell: (R() * CLASSES[cls].n) | 0, grp: R() < 0.5 ? 0 : 1 }); };
  for (const w of walls.values()) { let ux = (w.q[0] - w.a[0]) / w.L, uy = (w.q[1] - w.a[1]) / w.L, ax = w.a[0], ay = w.a[1]; if (ux * -w.ny + uy * w.nx < 0) { ax = w.q[0]; ay = w.q[1]; ux = -ux; uy = -uy; }     // u = left to right as read from the street
    const cap = w.d < 55 ? 38 + R() * 34 : 24 + R() * 20, top = w.h < 30 ? w.h + 5 + R() * 5 : Math.min(w.h - 1, cap), y0 = Math.max(w.lo + 0.5, 5.2); let s = 0.6;
    while (s < w.L - 4.5) { let cw = 6 + R() * 9; if (w.L - 0.6 - s - cw < 5) cw = w.L - 0.6 - s; if (cw < 4) break; let y = y0 + R() * 0.8;
      while (y < top - 3) { const k = R(), h = Math.min(top - y, k < 0.45 ? cw / (2.2 + R() * 0.8) : k < 0.8 ? cw * (0.85 + R() * 0.3) : Math.min(cw * 1.6, 20)); if (h < 2.6) break; if (R() < (w.d < 55 ? 1 : 0.85)) put(ax, ay, ux, uy, w.nx, w.ny, s, cw, y, h); y += h + 0.5; }
      s += cw + 0.6; } }
  if (!signs.length) return null;
  // 3. geometry: per (class, group) one mesh of screens; one mesh of dark frames behind them all
  const tex0 = new THREE.CanvasTexture(art()); tex0.colorSpace = THREE.SRGBColorSpace; tex0.anisotropy = 8; tex0.wrapS = THREE.RepeatWrapping;
  if (SHEET && Q.get('tsqart') !== '0') { const im = new Image(); im.onload = () => { if (im.width >= 1024 && im.width === im.height * 2) { for (const m of mats) { m.map.image = im; m.map.needsUpdate = true; } out.art = 'sheet'; } }; im.onerror = () => {}; im.src = SHEET; }     // a painted sheet beats the drawn one; a missing file changes nothing
  const grp = new THREE.Group(); grp.name = 'hero:timessquare'; const mats = [], fp = [], fi = [];
  const quad = (S, off, grow, P, I, U) => { const b = P.length / 3, x0 = S.ax + S.ux * (S.s0 - grow) + S.nx * off, y0 = S.ay + S.uy * (S.s0 - grow) + S.ny * off, x1 = S.ax + S.ux * (S.s0 + S.w + grow) + S.nx * off, y1 = S.ay + S.uy * (S.s0 + S.w + grow) + S.ny * off, lo = S.y0 - grow, hi = S.y0 + S.h + grow;
    P.push(x0, lo, -y0, x1, lo, -y1, x1, hi, -y1, x0, hi, -y0); I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    if (U) { const C = CLASSES[S.cls], u0 = S.cell / C.n, u1 = (S.cell + 1) / C.n, v1 = 1 - C.y / 1024, v0 = 1 - (C.y + C.h) / 1024, e = 0.002; U.push(u0 + e, v0 + e, u1 - e, v0 + e, u1 - e, v1 - e, u0 + e, v1 - e); } };
  for (let c = 0; c < CLASSES.length; c++) for (let g2 = 0; g2 < 2; g2++) { const P = [], I = [], U = []; for (const S of signs) if (S.cls === c && S.grp === g2) quad(S, 0.55, 0, P, I, U); if (!I.length) continue;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I);
    const t = tex0.clone(); t.needsUpdate = true; const m = new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }); m.userData = { cls: c, step: 1 / CLASSES[c].n, every: 5 + c * 1.7 + g2 * 2.6, at: 0 }; mats.push(m); grp.add(new THREE.Mesh(geo, m)); }
  // frames: a thin dark ring round each screen (four strips), not a full panel behind it. A full lit panel under every screen was drawn and then
  // covered: twice the fill for nothing (the final hand-over 1 files read 41 v 42 frames a second on a MacBook with the panels).
  const ring = (S) => { const g = 0.28, strips = [[-g, S.w + g, -g, 0], [-g, S.w + g, S.h, S.h + g], [-g, 0, 0, S.h], [S.w, S.w + g, 0, S.h]];
    for (const [a0, a1, b0, b1] of strips) { const b = fp.length / 3, x0 = S.ax + S.ux * (S.s0 + a0) + S.nx * 0.5, y0 = S.ay + S.uy * (S.s0 + a0) + S.ny * 0.5, x1 = S.ax + S.ux * (S.s0 + a1) + S.nx * 0.5, y1 = S.ay + S.uy * (S.s0 + a1) + S.ny * 0.5;
      fp.push(x0, S.y0 + b0, -y0, x1, S.y0 + b0, -y1, x1, S.y0 + b1, -y1, x0, S.y0 + b1, -y0); fi.push(b, b + 1, b + 2, b, b + 2, b + 3); } };
  for (const S of signs) ring(S);
  { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); geo.setIndex(fi);
    const fr = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x08090b, side: THREE.DoubleSide })); grp.add(fr); grp.userData.frameMat = fr.material; }
  // the light the screens throw on the square at night: one soft additive sheet just over the paving along the centre line (no lights added)
  const gc = document.createElement('canvas'); gc.width = 64; gc.height = 256; { const g = gc.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    const g2 = g.createLinearGradient(0, 0, 0, 256); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.12, 'rgba(0,0,0,0)'); g2.addColorStop(0.88, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = g2; g.fillRect(0, 0, 64, 256);
    g.globalCompositeOperation = 'multiply'; g.fillStyle = '#fff1dc'; g.fillRect(0, 0, 64, 256); }     /* one warm white: coloured bands read as painted stripes on the ground */
  const glow = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }); glow.map.colorSpace = THREE.SRGBColorSpace;
  const glowMesh = (() => { const dx = AX[1][0] - AX[0][0], dy = AX[1][1] - AX[0][1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, hw = 46, a = [AX[0][0] - ux * 30, AX[0][1] - uy * 30], b = [AX[1][0] + ux * 30, AX[1][1] + uy * 30], y = 0.22;
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([a[0] + uy * hw, y, -(a[1] - ux * hw), a[0] - uy * hw, y, -(a[1] + ux * hw), b[0] - uy * hw, y, -(b[1] + ux * hw), b[0] + uy * hw, y, -(b[1] - ux * hw)], 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute([1, 0, 0, 0, 0, 1, 1, 1], 2)); geo.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(geo, glow); m.material.side = THREE.DoubleSide; m.renderOrder = 3; m.visible = false; grp.add(m); return m; })();
  // the square's ground: the game tiles the whole bowtie, roadway and plaza alike, in pale beige; the real square is dark grey pavers and asphalt.
  // One multiply sheet a hand above the ground along the centre line, 96 m wide, fading to nothing over 16 m at its edges and ends (so no line shows
  // where it stops in the side streets). OFF unless ?tsqground=1: on Nov 16 it darkened the sidewalk blocks but not the bowtie's beige roadway tiles, which the
  // streets ground layer draws over it (stills shots/tsq-g5..g7). The fix belongs in that layer.
  let paveTris = 0;
  if (Q.get('tsqground') === '1') { const dx = AX[1][0] - AX[0][0], dy = AX[1][1] - AX[0][1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, P = [], Cc = [], I = [], us = [-64, -48, 48, 64], vs = [-34, -16, l + 16, l + 34], tint = [0.60, 0.62, 0.68];
    for (let j2 = 0; j2 < 4; j2++) for (let i2 = 0; i2 < 4; i2++) { const x = AX[0][0] + ux * vs[j2] + uy * us[i2], y = AX[0][1] + uy * vs[j2] - ux * us[i2], inner = i2 > 0 && i2 < 3 && j2 > 0 && j2 < 3; P.push(x, 0.27, -y); Cc.push(...(inner ? tint : [1, 1, 1])); }
    for (let j2 = 0; j2 < 3; j2++) for (let i2 = 0; i2 < 3; i2++) { const a = j2 * 4 + i2; I.push(a, a + 1, a + 5, a, a + 5, a + 4); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); geo.setIndex(I);
    const pm = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: false, toneMapped: false })); pm.renderOrder = 2; grp.add(pm); paveTris = I.length / 3; }
  const out = { group: grp, signs: signs.length, walls: walls.size, calls: grp.children.length, tris: signs.length * 4, pave: paveTris, ots: 'wait' };
  const night = W.shared && W.shared.uNightK, first = grp.children[0]; let t0 = performance.now() / 1000;
  first.onBeforeRender = () => { const t = performance.now() / 1000, k = night ? night.value.y : 0, v = 0.92 - 0.42 * k; glow.opacity = 0.022 * k; glowMesh.visible = k > 0.02; for (const m of mats) { m.color.setScalar(v); const u = m.userData; if (t - t0 > u.at + u.every) { u.at = t - t0; m.map.offset.x = (m.map.offset.x + u.step) % 1; } } };
  W.scene.add(grp);
  // One Times Square: the model's own screens (hero entry lm_ots; meshes screen_NN with 0..1 uvs, upper-left = 0,0) take the same pictures.
  // No model (?hero=0, or it failed): a plain stack of screens on the north end instead.
  const stack = () => { const dx = AX[1][0] - AX[0][0], dy = AX[1][1] - AX[0][1], l = Math.hypot(dx, dy), nx = dx / l, ny = dy / l, ux = -ny, uy = nx, cx = 27.3 + nx * 0.9, cy = 1288.7 + ny * 0.9; let y = 9; const own = [], P = [], I = [], U = [], fp2 = [], fi2 = [];
    for (const h of [10, 8, 13, 7, 11, 9]) { own.push({ ax: cx - ux * 5.5, ay: cy - uy * 5.5, ux, uy, nx, ny, s0: 0, w: 11, y0: y, h, cls: 0, cell: (R() * 4) | 0 }); y += h + 0.8; }
    for (const S of own) { quad(S, 0.55, 0, P, I, U); quad(S, 0.42, 0.28, fp2, fi2, null); } const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); geo.setIndex(I); grp.add(new THREE.Mesh(geo, mats[0]));
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(fp2, 3)); g2.setIndex(fi2); g2.computeVertexNormals(); grp.add(new THREE.Mesh(g2, grp.userData.frameMat)); out.ots = 'stack'; };
  // the model's 22 screens become one mesh per picture row (they were 22 draw calls in every pass); the model's own quads are hidden
  const bind = (root) => { let n = 0; const acc = new Map(); root.updateWorldMatrix(true, true); const v = new THREE.Vector3();
    root.traverse((o) => { if (!o.isMesh || !/^screen_\d+/.test(o.name)) return; const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv; g.computeBoundingBox(); const bb = g.boundingBox, w = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h = bb.max.y - bb.min.y, c = classOf(w, h, R()), C = CLASSES[c], cell = (R() * C.n) | 0;
      const u0 = cell / C.n, u1 = (cell + 1) / C.n, v1 = 1 - C.y / 1024, v0 = 1 - (C.y + C.h) / 1024; let A = acc.get(c); if (!A) acc.set(c, (A = { P: [], U: [], I: [] })); const b = A.P.length / 3;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); A.P.push(v.x, v.y, v.z); A.U.push(u0 + uv.getX(i) * (u1 - u0), v1 - uv.getY(i) * (v1 - v0)); }
      if (g.index) for (let i = 0; i < g.index.count; i++) A.I.push(b + g.index.getX(i)); else for (let i = 0; i < pos.count; i++) A.I.push(b + i); o.visible = false; n++; });
    for (const [c, A] of acc) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(A.P, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(A.U, 2)); geo.setIndex(A.I); const m = new THREE.Mesh(geo, mats.find((q) => q.userData.cls === c) || mats[0]); m.position.y = 0.02; grp.add(m); }
    out.ots = 'model: ' + n + ' screens in ' + acc.size + ' meshes'; };
  { let tries = 0; const iv = setInterval(() => { const st = W.heroState, s = st && st.groups && st.groups.lm_ots, root = W.heroRoot && W.heroRoot.getObjectByName('hero_lm_ots'); tries++;
      if (root && s === 'in') { clearInterval(iv); bind(root); } else if (s === 'failed' || (!st && tries > 5) || (st && !('lm_ots' in st.groups) && tries > 5) || tries > 240) { clearInterval(iv); stack(); } }, 1000); }
  window.__tsq = out; game.tsq = out; return out;
}
