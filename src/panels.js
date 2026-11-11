// panels.js (facades lane): walls drawn from straightened photographs of real New York facades. Each layer of tPanel is a piece of a real front,
// a whole number of window bays by storeys; the facade shader lays one photo bay on each window bay. Alpha marks glass.
// panels.json: [{file, style, bays, storeys, bay_m, storey_m, glass:[[x0,y0,x1,y1],...]}]; credits in assets/panels/SOURCES.md.
import * as THREE from 'three';
// glass52: tPanel holds every panel at 768 px; a panel whose file is 2048 px or more also gets a sharp 2048 px layer in tPanelH (at most MAXH of them: 22 MB of GPU memory each with mips)
const S = 768, SH = 2048, MAXH = 4, MAXP = 32, ORDER = ['walkup', 'lightbrick', 'stone', 'glass', 'postwar', 'loft'];
export function panelUniforms() {
  return { tPanel: { value: null }, tPanelR: { value: null }, tPanelH: { value: null }, uPanelH: { value: new Array(MAXP).fill(-1) }, uPanel: { value: Array.from({ length: MAXP }, () => new THREE.Vector4(1, 1, 3, 3.3)) }, uStyleP: { value: Array.from({ length: 5 }, () => new THREE.Vector2(0, 0)) } };
}
export async function loadPanels(dir, shared) {
  const off = new URLSearchParams(location.search).get('panels') === '0';
  const meta = off ? [] : await fetch(dir + 'panels.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const list = meta.filter((m) => ORDER.includes(m.style)).sort((a, b) => ORDER.indexOf(a.style) - ORDER.indexOf(b.style)).slice(0, MAXP);
  const n = Math.max(1, list.length), data = new Uint8Array(S * S * 4 * n);
  const cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d', { willReadFrequently: true });
  await Promise.all(list.map(async (m, i) => {
    const bmp = await createImageBitmap(await (await fetch(dir + m.file)).blob()); m._bmp = bmp;
  }));
  const hi = list.map((m, i) => (m._bmp.width >= SH ? i : -1)).filter((i) => i >= 0).slice(0, MAXH); const nh = Math.max(1, hi.length), dataH = new Uint8Array(hi.length ? SH * SH * 4 * nh : 4);
  const cvh = document.createElement('canvas'); cvh.width = cvh.height = hi.length ? SH : 1; const gh = cvh.getContext('2d', { willReadFrequently: true });
  // one layer: the photo, alpha = glass with a soft edge
  const fill = (m, ctx, Z, out, o) => { ctx.clearRect(0, 0, Z, Z); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(m._bmp, 0, 0, Z, Z); const px = ctx.getImageData(0, 0, Z, Z).data; const E = 3 * Z / 768;
    const a = new Float32Array(Z * Z);
    for (const r of (m.glass || []).concat(m.glass_transoms || [])) { const x0 = r[0] * Z, y0 = r[1] * Z, x1 = r[2] * Z, y1 = r[3] * Z;
      for (let y = Math.max(0, Math.floor(y0 - E)); y < Math.min(Z, y1 + E); y++) for (let x = Math.max(0, Math.floor(x0 - E)); x < Math.min(Z, x1 + E); x++) {
        const d = Math.min(x - x0, x1 - x, y - y0, y1 - y); a[y * Z + x] = Math.max(a[y * Z + x], Math.min(1, Math.max(0, d / E + 0.5))); } }
    for (let k = 0; k < Z * Z; k++) { out[o + k * 4] = px[k * 4]; out[o + k * 4 + 1] = px[k * 4 + 1]; out[o + k * 4 + 2] = px[k * 4 + 2]; out[o + k * 4 + 3] = a[k] * 255; } };
  list.forEach((m, i) => { fill(m, g, S, data, i * S * S * 4); const h = hi.indexOf(i); if (h >= 0) fill(m, gh, SH, dataH, h * SH * SH * 4); shared.uPanelH.value[i] = h;
    shared.uPanel.value[i].set(m.bays, m.storeys, m.bay_m, m.storey_m); m._bmp.close(); });
  const mk = (d, Z, n, an) => { const t = new THREE.DataArrayTexture(d, Z, Z, n); t.format = THREE.RGBAFormat; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = Z > 1;
    t.minFilter = Z > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = an; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };      // bays are laid in the photo's own order, so the photo's far edge is each edge's true neighbour
  shared.tPanel.value = mk(data, S, n, 8); shared.tPanelH.value = mk(dataH, hi.length ? SH : 1, nh, 16);
  // glass item: tPanelR, a small float map per panel that gives, at any point of the panel, the rectangle [x0,y0,x1,y1] of the nearest window opening,
  // so the facade shader can rebuild each photographed opening as a real window (reveal, frame, sash, room, mirror).
  const RS = 128, rd = new Float32Array(RS * RS * 4 * n * 3);      // layers n..2n-1: the same opening's sill [foot y, x0, x1, foot of a course hanging in from above] (panels.json "sill"); 2n..3n-1: its lintel [top y, x0, x1, underside y] ("lintel"); zero where none
  list.forEach((m, i) => { const gl = m.glass || []; if (!gl.length) return;
    for (let y = 0; y < RS; y++) for (let x = 0; x < RS; x++) { const u = (x + 0.5) / RS, v = (y + 0.5) / RS; let best = 1e9, br = gl[0];
      let bk = 0; gl.forEach((r, k) => { const d = Math.max(r[0] - u, u - r[2], r[1] - v, v - r[3]); if (d < best) { best = d; br = r; bk = k; } });
      rd.set(br, (i * RS * RS + y * RS + x) * 4); const sl = (m.sill || [])[bk]; if (sl && (sl[0] > 0 || sl[3] > 0)) rd.set([sl[0], sl[1] - (m.course ? 10 : 0), sl[2], sl[3] || 0], ((n + i) * RS * RS + y * RS + x) * 4);
      const ln = (m.lintel || [])[bk]; if (ln && ln[3] > 0) rd.set(ln, ((2 * n + i) * RS * RS + y * RS + x) * 4); } });
  const tr = new THREE.DataArrayTexture(rd, RS, RS, n * 3); tr.format = THREE.RGBAFormat; tr.type = THREE.FloatType; tr.minFilter = tr.magFilter = THREE.NearestFilter;
  tr.generateMipmaps = false; tr.wrapS = tr.wrapT = THREE.ClampToEdgeWrapping; tr.needsUpdate = true; shared.tPanelR.value = tr;
  // style -> [first layer, count]: 0 brick walk-up (walkup + lightbrick), 1 stone prewar (lightbrick + stone), 2 glass, 3 postwar, 4 loft
  const idx = (names) => { const is = list.map((m, i) => (names.includes(m.style) ? i : -1)).filter((i) => i >= 0); return is.length ? [is[0], is.length] : [0, 0]; };
  [['walkup', 'lightbrick'], ['lightbrick', 'stone'], ['glass'], ['postwar'], ['loft']].forEach((names, s) => shared.uStyleP.value[s].set(...idx(names)));
  console.log('[game] facade panels: ' + list.length + ', sharp: ' + hi.length + ', texture memory about ' + Math.round((n * S * S + hi.length * SH * SH) * 4 * 1.333 / 1048576) + ' MB');
}
