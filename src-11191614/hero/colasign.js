// hero/colasign.js (brooklyn lane, Nov 15; Matt: "the Coca-Cola sign would be so cool... But like some fake brand"): the big red cola sign on the
// Long Island City waterfront at Gantry Plaza, facing Midtown over the East River. A FAKE brand ("Fizzi-Cola"), lettering drawn here in a plain
// cursive (no real name, no real script). Open channel letters on a steel lattice frame, 37 m long and 18 m high like the real one, with a 15 m
// bottle at its right end; red paint by day, red neon at night (world.shared.uNightK.y). Scenery: it stands on the far bank (streets/bank.js land),
// nobody reaches it yet. ?colasign=0 = off. No asset: one canvas texture, 3 draw calls. window.__colasign for a look.
import * as THREE from 'three';

export const SIGN = { x: 2420, y: 311, face: [-0.94, 0.34], w: 37, h: 18, base: 7.5, name: 'Fizzi-Cola' };   // map metres; face = the way the letters look (to Midtown)

function art(name) {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineCap = 'round';
  // the lettering: a slanted cursive, fitted to the width left of the bottle; a swash under it
  const TW = W * 0.80; let px = 620; const font = (s) => `italic 700 ${s}px "Brush Script MT", "Segoe Script", "Lucida Handwriting", "Snell Roundhand", "Apple Chancery", cursive`;
  g.font = font(px); let m = g.measureText(name).width; px = Math.floor(px * Math.min(1, (TW - 60) / m)); g.font = font(px); m = g.measureText(name).width;
  { const mt = g.measureText(name), asc = mt.actualBoundingBoxAscent || px * 0.7, des = mt.actualBoundingBoxDescent || px * 0.2, th = asc + des, sy = Math.min(2.2, (H * 0.66) / th);     // stretched up to fill the frame, as the real letters do
    g.save(); g.translate(30 + (TW - 60 - m) / 2, H * 0.10 + asc * sy); g.scale(1, sy); g.lineWidth = px * 0.075; g.fillText(name, 0, 0); g.strokeText(name, 0, 0); g.restore();
    g.lineWidth = 34; g.beginPath(); g.moveTo(TW * 0.08, H * 0.90); g.bezierCurveTo(TW * 0.35, H * 0.97, TW * 0.65, H * 0.82, TW * 0.97, H * 0.90); g.stroke(); }
  // the bottle (a plain contour bottle, outline and bands, as the sign's is built of neon tubes)
  const cx = W * 0.905, top = H * 0.07, bot = H * 0.95, hh = bot - top, r = (t) => { const neck = 0.20, sh = 0.40; return W * 0.085 * (t < 0.07 ? 0.34 : t < neck ? 0.30 : t < sh ? 0.30 + 0.70 * (0.5 - 0.5 * Math.cos(Math.PI * (t - neck) / (sh - neck))) : 1 - 0.10 * Math.sin(Math.PI * (t - sh) / (1 - sh))); };
  g.lineWidth = 26; g.beginPath(); for (let i = 0; i <= 60; i++) { const t = i / 60; g[i ? 'lineTo' : 'moveTo'](cx - r(t), top + hh * t); } for (let i = 60; i >= 0; i--) { const t = i / 60; g.lineTo(cx + r(t), top + hh * t); } g.closePath(); g.stroke();
  g.lineWidth = 18; for (const t of [0.07, 0.46, 0.50, 0.70, 0.74]) { g.beginPath(); g.moveTo(cx - r(t), top + hh * t); g.lineTo(cx + r(t), top + hh * t); g.stroke(); }
  g.font = `italic 700 ${Math.floor(W * 0.034)}px "Brush Script MT", "Segoe Script", cursive`; g.textAlign = 'center'; g.fillText('Fizzi', cx, top + hh * 0.63);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}

// the lattice frame behind the letters: posts, girders and diagonals as one merged box mesh
function frame(S) {
  const P = [], I = []; const box = (x0, y0, x1, y1, t, z) => {     // a bar from (x0, y0) to (x1, y1) in the sign's plane, t thick, at depth z
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy * t / 2, ny = ux * t / 2, b = P.length / 3;
    for (const zz of [z - t / 2, z + t / 2]) P.push(x0 + nx, y0 + ny, zz, x1 + nx, y1 + ny, zz, x1 - nx, y1 - ny, zz, x0 - nx, y0 - ny, zz);
    for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]]) I.push(b + f[0], b + f[1], b + f[2], b + f[0], b + f[2], b + f[3]); };
  const w2 = S.w / 2, top = S.base + S.h, n = 9;
  for (const z of [-0.9, -2.6]) { for (let i = 0; i <= n; i++) { const x = -w2 + S.w * i / n; box(x, 0, x, top - (z < -1 ? 2 : 0), 0.22, z); }
    for (const y of [S.base * 0.5, S.base, S.base + S.h * 0.33, S.base + S.h * 0.66, top - (z < -1 ? 2 : 0)]) box(-w2, y, w2, y, 0.16, z);
    for (let i = 0; i < n; i++) { const xa = -w2 + S.w * i / n, xb = -w2 + S.w * (i + 1) / n; box(i % 2 ? xb : xa, 0, i % 2 ? xa : xb, S.base, 0.14, z); box(i % 2 ? xa : xb, S.base, i % 2 ? xb : xa, S.base + S.h * 0.33, 0.12, z); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals(); return g;
}

export function install(game) {
  const W = game.world, city = game.city; if (!W || !W.scene || !(city.water || []).some((w) => /east river/i.test(w.name || ''))) return null;
  const S = SIGN, grp = new THREE.Group(); grp.name = 'hero:colasign';
  grp.position.set(S.x, 0.3, -S.y); grp.rotation.y = Math.atan2(S.face[0], -S.face[1]);     // local +z = the way the letters look
  const tex = art(S.name), night = W.shared && W.shared.uNightK;
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a1512, roughness: 0.8, metalness: 0.3 });
  const fr = new THREE.Mesh(frame(S), steel); fr.castShadow = true; grp.add(fr);
  // the letters: three alpha-cut sheets a hand apart give the channel letters their depth; the front one glows at night
  const body = new THREE.MeshStandardMaterial({ color: 0xb3120f, roughness: 0.55, metalness: 0.1, alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  const glow = new THREE.MeshStandardMaterial({ color: 0xc41410, roughness: 0.5, alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xff1d12, emissiveMap: tex, emissiveIntensity: 0 });
  const pg = new THREE.PlaneGeometry(S.w, S.h); pg.translate(0, S.base + S.h / 2, 0);
  for (const z of [-0.45, -0.22]) { const m = new THREE.Mesh(pg, body); m.position.z = z; grp.add(m); }
  const front = new THREE.Mesh(pg, glow); front.castShadow = true; grp.add(front);
  front.onBeforeRender = () => { const k = night ? night.value.y : 0; glow.emissiveIntensity = 0.04 + 1.15 * k; };
  grp.traverse((o) => { o.frustumCulled = true; }); W.scene.add(grp);
  const out = { group: grp, sign: S, tris: fr.geometry.index.count / 3 + 6, calls: 4 }; window.__colasign = out; game.colasign = out; return out;
}
