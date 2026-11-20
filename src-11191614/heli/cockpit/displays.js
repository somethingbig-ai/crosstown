// displays.js: the screens that light: the moving-map GPS, the radio and transponder windows, and the caution / warning panel.
// One 1024 x 512 canvas; each region is redrawn only when what it shows has changed (the map a few times a second, like a real one).
import { DYN, CWP_CELLS } from './layout.js';
import { KT, altFt, compassDeg } from './scales.js';

const F = '"DIN Alternate","Helvetica Neue",Helvetica,Arial,sans-serif', MONO = '"Menlo","SF Mono","Courier New",monospace';

export class Displays {
  constructor(mk, game, heli) {
    this.cv = mk(DYN.W, DYN.H); this.x = this.cv.getContext('2d'); this.game = game; this.heli = heli; this.dirty = true;
    this.x.fillStyle = '#000'; this.x.fillRect(0, 0, DYN.W, DYN.H);
    this.base = null; this.mk = mk; this.tMap = 1e9; this.cwpKey = ''; this.radioKey = ''; this.wp = 0;
    try { this.buildBase(); } catch (e) { console.log('[heli] cockpit map base failed: ' + (e && e.message)); }
  }
  // the whole city once, north up, as a GPS draws it: blocks, parks, streets, avenues
  buildBase() {
    const city = this.game && this.game.city; if (!city || !city.meta) return;
    /* tiles lane: the picture is centred on the whole playable box (city.meta.play when the city has more than one area) and reaches the old margin beyond it; the old city gives the same picture as before */
    const M0 = city.meta, pb = M0.play || [-M0.px, -M0.py, M0.px, M0.py], bcx = (pb[0] + pb[2]) / 2, bcy = (pb[1] + pb[3]) / 2, half = Math.max((pb[2] - pb[0]) / 2 + M0.hx - M0.px, (pb[3] - pb[1]) / 2 + M0.hy - M0.py) + 60, N = 2048, s = N / (2 * half), cv = this.mk(N, N), x = cv.getContext('2d');
    const X = (px) => (px - bcx + half) * s, Y = (py) => (half - (py - bcy)) * s;
    x.fillStyle = '#0b1418'; x.fillRect(0, 0, N, N);
    const poly = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])))); x.closePath(); };
    x.fillStyle = '#27333a'; for (const b of city.blocks || []) { if (!b.ext) continue; poly(b.ext); x.fill(); }
    x.fillStyle = '#1f6a34'; for (const p of city.parks || []) { if (!p.ext) continue; poly(p.ext); x.fill(); }
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (const pass of [0, 1]) for (const e of city.edges || []) { if (!e.pts || !!e.ave !== !!pass) continue; x.strokeStyle = e.ave ? '#d9c05a' : '#7c8a92'; x.lineWidth = Math.max(1.2, (e.width || 9) * s * (e.ave ? 0.55 : 0.4)); x.beginPath(); e.pts.forEach((p, i) => (i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])))); x.stroke(); }
    this.base = cv; this.baseS = s; this.baseHalf = half; this.baseC = [bcx, bcy];
  }
  // f: flight; cw: { caption: lit } ; returns true if the picture changed
  update(f, dt, lit, t) {
    let ch = false; const x = this.x;
    // ---- map: 4 times a second
    this.tMap += dt;
    if (this.tMap > 0.25) { this.tMap = 0; this.drawMap(f); ch = true; }
    // ---- caution panel: when a light changes (the red ones flash, so their phase is part of the key)
    const phase = Math.floor(t * 2.5) % 2; let key = ''; for (const c of CWP_CELLS) key += lit[c[0]] ? (c[1] === 'r' ? (phase ? '2' : '1') : '1') : '0';
    if (key !== this.cwpKey) { this.cwpKey = key; this.drawCwp(lit, phase); ch = true; }
    // ---- radios: the transponder's flight level and its reply lamp
    const fl = Math.max(0, Math.round(altFt(f.pos.y) / 100)), reply = Math.floor(t * 0.7) % 3 === 0 ? 1 : 0, rk = fl + '_' + reply;
    if (rk !== this.radioKey) { this.radioKey = rk; this.drawRadios(fl, reply); ch = true; }
    return ch;
  }
  drawMap(f) {
    const x = this.x, [gx, gy, gw, gh] = DYN.gps, h = this.heli, mapX = f.pos.x, mapY = -f.pos.z, hdg = compassDeg(f.heading), gs = Math.hypot(f.vel.x, f.vel.z) * KT;
    x.save(); x.beginPath(); x.rect(gx, gy, gw, gh); x.clip(); x.fillStyle = '#081014'; x.fillRect(gx, gy, gw, gh);
    const mapW = gw - 118, cx = gx + 118 + mapW / 2, cy = gy + 40 + (gh - 40) * 0.66, pxPerM = mapW / 900;      // 900 m across the map
    x.save(); x.beginPath(); x.rect(gx + 118, gy + 40, mapW, gh - 40); x.clip();
    if (this.base) { x.save(); x.translate(cx, cy); x.rotate(-hdg * Math.PI / 180); const k = pxPerM / this.baseS; x.scale(k, k); x.drawImage(this.base, -(mapX - this.baseC[0] + this.baseHalf) * this.baseS, -(this.baseHalf - (mapY - this.baseC[1])) * this.baseS); x.restore(); }
    // the pads as waypoints, and a magenta leg to the active one
    const pads = (h && h.pads) || [], rot = (px, py) => { const dx = px - mapX, dy = py - mapY, a = hdg * Math.PI / 180, ex = dx * Math.cos(a) - dy * Math.sin(a), ny = dx * Math.sin(a) + dy * Math.cos(a); return [cx + ex * pxPerM, cy - ny * pxPerM]; };
    let near = null, nd = 1e9; pads.forEach((p, i) => { const d = Math.hypot(p.x - mapX, p.y - mapY); if (i === this.wp) { near = p; nd = d; } });
    if (near && nd < 40 && pads.length > 1 && f.onGround) { this.wp = (this.wp + 1) % pads.length; }
    if (near) { const q = rot(near.x, near.y); x.strokeStyle = '#ff3df2'; x.lineWidth = 3.5; x.beginPath(); x.moveTo(cx, cy); x.lineTo(q[0], q[1]); x.stroke(); }
    pads.forEach((p, i) => { const q = rot(p.x, p.y); x.fillStyle = '#081014'; x.strokeStyle = '#6fe3ff'; x.lineWidth = 2; x.beginPath(); x.arc(q[0], q[1], 7, 0, 7); x.fill(); x.stroke(); x.fillStyle = '#6fe3ff'; x.font = `700 10px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', q[0], q[1] + 0.5); x.font = `600 12px ${F}`; x.textAlign = 'left'; x.fillText('PAD' + (i + 1), q[0] + 11, q[1]); });
    // range ring and own ship
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 1.2; x.setLineDash([5, 5]); x.beginPath(); x.arc(cx, cy, 250 * pxPerM, 0, 7); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#ffffff'; x.font = `600 11px ${F}`; x.textAlign = 'left'; x.fillText('250 m', cx + 250 * pxPerM * 0.72, cy - 250 * pxPerM * 0.72 - 6);
    x.fillStyle = '#ffffff'; x.strokeStyle = '#000'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(cx, cy - 13); x.lineTo(cx + 9, cy + 10); x.lineTo(cx, cy + 5); x.lineTo(cx - 9, cy + 10); x.closePath(); x.fill(); x.stroke();
    // north arrow
    { const a = -hdg * Math.PI / 180, nx = gx + gw - 26, ny = gy + 66; x.save(); x.translate(nx, ny); x.rotate(a); x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, -13); x.lineTo(6, 6); x.lineTo(0, 2); x.lineTo(-6, 6); x.fill(); x.font = `700 11px ${F}`; x.textAlign = 'center'; x.fillText('N', 0, -20); x.restore(); }
    x.restore();
    // top bar and the data column
    x.fillStyle = '#0d2a52'; x.fillRect(gx, gy, gw, 40); x.fillStyle = '#12161a'; x.fillRect(gx, gy + 40, 118, gh - 40); x.strokeStyle = '#3a4650'; x.lineWidth = 1.5; x.strokeRect(gx + 118, gy + 40, mapW, gh - 40);
    const T = (s, px, py, size, col = '#fff', w = 600, al = 'left', font = F) => { x.fillStyle = col; x.font = `${w} ${size}px ${font}`; x.textAlign = al; x.textBaseline = 'middle'; x.fillText(s, gx + px, gy + py); };
    T('118.700', 10, 13, 16, '#fff', 700); T('121.500', 10, 30, 13, '#6fe3ff', 600); T('COM', 86, 13, 10, '#9fb4c8'); T('MAP', gw - 12, 21, 16, '#7dff7a', 700, 'right'); T('GPS  TRK UP', gw / 2 + 20, 21, 14, '#fff', 600, 'center');
    const brg = near ? ((Math.atan2(near.x - mapX, near.y - mapY) * 180 / Math.PI) + 360) % 360 : 0;
    const cell = (i, lab, val, col = '#fff') => { T(lab, 8, 58 + i * 56, 11, '#9fb4c8', 600); T(val, 110, 80 + i * 56, 23, col, 700, 'right'); x.strokeStyle = '#2a343c'; x.beginPath(); x.moveTo(gx, gy + 98 + i * 56); x.lineTo(gx + 118, gy + 98 + i * 56); x.stroke(); };
    cell(0, 'GS  KT', String(Math.round(gs))); cell(1, 'TRK', String(Math.round(hdg)).padStart(3, '0') + '°'); cell(2, 'ALT  FT', String(Math.round(altFt(f.pos.y) / 10) * 10));
    cell(3, 'BRG', near ? String(Math.round(brg)).padStart(3, '0') + '°' : '---', '#ff3df2'); cell(4, 'DIS  NM', near ? (nd / 1852).toFixed(2) : '--.--', '#ff3df2'); cell(5, 'WPT', near ? 'PAD' + (pads.indexOf(near) + 1) : '----', '#ff3df2');
    x.restore();
  }
  drawCwp(lit, phase) {
    const x = this.x, [gx, gy, gw, gh] = DYN.cwp, cols = 8, rows = 3, cw = gw / cols, ch = gh / rows; x.fillStyle = '#050505'; x.fillRect(gx, gy, gw, gh);
    CWP_CELLS.forEach((c, i) => {
      const px = gx + (i % cols) * cw, py = gy + Math.floor(i / cols) * ch, on = lit[c[0]] && !(c[1] === 'r' && lit[c[0]] === 'flash' && !phase);
      const col = c[1] === 'r' ? [255, 48, 28] : c[1] === 'a' ? [255, 176, 20] : [70, 255, 90];
      x.fillStyle = on ? `rgb(${col[0]},${col[1]},${col[2]})` : `rgba(${col[0]},${col[1]},${col[2]},0.02)`; x.fillRect(px + 3, py + 3, cw - 6, ch - 6);
      if (on) { const g = x.createRadialGradient(px + cw / 2, py + ch / 2, 2, px + cw / 2, py + ch / 2, cw * 0.6); g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(px + 3, py + 3, cw - 6, ch - 6); }
      x.fillStyle = on ? '#140600' : `rgba(${col[0]},${col[1]},${col[2]},0.13)`; x.font = `800 ${c[0].length > 7 ? 18 : 21}px ${F}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(c[0], px + cw / 2, py + ch / 2 + 1);
    });
  }
  drawRadios(fl, reply) {
    const x = this.x; let [gx, gy, gw, gh] = DYN.com; x.fillStyle = '#0a0503'; x.fillRect(gx, gy, gw, gh);
    const seg = (s, px, py, size, a = 1) => { x.fillStyle = `rgba(255,120,30,${a})`; x.font = `700 ${size}px ${MONO}`; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(s, px, py); };
    seg('888.888', gx + 18, gy + gh / 2 + 2, 52, 0.07); seg('888.888', gx + 262, gy + gh / 2 + 2, 52, 0.07);
    seg('118.700', gx + 18, gy + gh / 2 + 2, 52); seg('121.500', gx + 262, gy + gh / 2 + 2, 52, 0.92); seg('TX', gx + 236, gy + 20, 13, 0.25);
    [gx, gy, gw, gh] = DYN.xpdr; x.fillStyle = '#0a0503'; x.fillRect(gx, gy, gw, gh);
    seg('8888', gx + 16, gy + gh / 2 + 2, 56, 0.07);
    seg('1200', gx + 16, gy + gh / 2 + 2, 56); seg('ALT', gx + 192, gy + 26, 22); seg('FL' + String(fl).padStart(3, '0'), gx + 192, gy + 66, 30); seg('R', gx + 322, gy + 26, 22, reply ? 1 : 0.12);
  }
}
