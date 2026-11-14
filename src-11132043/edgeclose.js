// edgeclose.js (lead, Nov 13; CHIEF 23:3xZ, player report 1b7ddd): the edge of the playable map is an invisible wall with drawn city beyond it.
// Until the bigger map moves it, every road that crosses the edge gets a plain road-closed barricade line on the wall: striped boards on legs
// across the roadway and both sidewalks, and one ROAD CLOSED board in the middle. Own geometry and a canvas picture, no outside asset.
// Nothing collides: the wall itself (game.js, statics) is what stops cars and people; the line stands 0.5 m beyond it. ?edgeclose=0 off.
import * as THREE from 'three';

export function install(game) {
  if (game.__edgeclose || (game.P && game.P.get('edgeclose') === '0') || !game.roads || !game.world || !game.bounds) return game.__edgeclose || null;
  const bx = game.bounds.x + 6, by = game.bounds.y + 6, ecx = game.bounds.cx || 0, ecy = game.bounds.cy || 0     /* tiles lane: the playable box may sit off the origin */, OUT = 0.5, UNIT = 2.4, SIDE = 4.5, MAXSPAN = 36;
  const inside = (p) => Math.abs(p[0] - ecx) < bx && Math.abs(p[1] - ecy) < by;
  // every place a road's centre line crosses the wall: the point on the wall, which wall, and how long the line across the road must be
  const sites = [];
  for (const e of game.roads.edges) { const P = e.pts; for (let i = 0; i + 1 < P.length; i++) { const a = P[i], b = P[i + 1]; if (inside(a) === inside(b)) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1]; let best = null;
    for (const [ax, lim, sg] of [[0, ecx + bx, 1], [0, ecx - bx, -1], [1, ecy + by, 1], [1, ecy - by, -1]]) { const d = ax ? dy : dx, o = ax ? a[1] : a[0]; if (Math.abs(d) < 1e-6) continue; const t = (lim - o) / d; if (t < 0 || t > 1) continue;
      const x = a[0] + dx * t, y = a[1] + dy * t; if (Math.abs(x - ecx) > bx + 0.01 || Math.abs(y - ecy) > by + 0.01) continue; if (!best || t < best.t) best = { t, x, y, ax, sgn: sg }; }
    if (!best) continue; const L = Math.hypot(dx, dy) || 1, across = Math.abs(best.ax ? dy : dx) / L;      // cosine between the road and the wall's normal
    const span = Math.min(MAXSPAN, ((e.width || 9) + 2 * SIDE) / Math.max(0.35, across));
    if (sites.some((s) => s.ax === best.ax && s.sgn === best.sgn && Math.hypot(s.x - best.x, s.y - best.y) < (s.span + span) / 2)) { const s = sites.find((q) => q.ax === best.ax && q.sgn === best.sgn && Math.hypot(q.x - best.x, q.y - best.y) < (q.span + span) / 2); const lo = Math.min((s.ax ? s.x : s.y) - s.span / 2, (best.ax ? best.x : best.y) - span / 2), hi = Math.max((s.ax ? s.x : s.y) + s.span / 2, (best.ax ? best.x : best.y) + span / 2); if (s.ax) s.x = (lo + hi) / 2; else s.y = (lo + hi) / 2; s.span = Math.min(60, hi - lo); continue; }      // two carriageways side by side: one line
    sites.push({ x: best.x, y: best.y, ax: best.ax, sgn: best.sgn, span }); } }
  if (!sites.length) return (game.__edgeclose = { sites: 0 });

  // pictures: diagonal orange and white stripes for the boards; white board with black letters for the sign
  const cv = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const stripes = cv(256, 64, (g) => { g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#e2601a'; for (let x = -64; x < 256; x += 64) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 32, 64); g.lineTo(x + 96, 0); g.lineTo(x + 64, 0); g.fill(); } });
  stripes.wrapS = THREE.RepeatWrapping;
  const signTex = cv(512, 256, (g) => { g.fillStyle = '#efece2'; g.fillRect(0, 0, 512, 256); g.strokeStyle = '#111'; g.lineWidth = 10; g.strokeRect(12, 12, 488, 232); g.fillStyle = '#111'; g.font = '900 96px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ROAD', 256, 82); g.fillText('CLOSED', 256, 176); });
  const boardMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.75, metalness: 0 }), legMat = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.8, metalness: 0.1 });
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  const boardGeo = new THREE.BoxGeometry(UNIT - 0.06, 0.2, 0.03), legGeo = new THREE.BoxGeometry(0.05, 1.5, 0.3), signGeo = new THREE.PlaneGeometry(1.5, 0.75);
  let units = 0; for (const s of sites) { s.n = Math.max(2, Math.ceil(s.span / UNIT)); units += s.n; }
  const boards = new THREE.InstancedMesh(boardGeo, boardMat, units * 3), legs = new THREE.InstancedMesh(legGeo, legMat, units * 2), signs = new THREE.InstancedMesh(signGeo, signMat, sites.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0); let bi = 0, li = 0, si = 0;
  for (const s of sites) {
    // map (x, y) -> scene (x, 0, -y). A line along the wall: wall x = const runs along map y (scene z); wall y = const runs along map x.
    const yaw = s.ax ? 0 : Math.PI / 2; q.setFromAxisAngle(up, yaw);
    const ox = s.ax ? 0 : s.sgn * OUT, oy = s.ax ? s.sgn * OUT : 0, len = s.n * UNIT;
    for (let k = 0; k < s.n; k++) { const u = -len / 2 + (k + 0.5) * UNIT, x = s.x + ox + (s.ax ? u : 0), y = s.y + oy + (s.ax ? 0 : u);
      for (const h of [0.55, 0.95, 1.35]) { m.compose(p.set(x, h, -y), q, one); boards.setMatrixAt(bi++, m); }
      for (const d of [-UNIT / 2 + 0.25, UNIT / 2 - 0.25]) { m.compose(p.set(x + (s.ax ? d : 0), 0.75, -(y + (s.ax ? 0 : d))), q, one); legs.setMatrixAt(li++, m); } }
    // the sign faces the city (and reads from behind too): on the inner side of the boards, above them
    const qs = new THREE.Quaternion().setFromAxisAngle(up, s.ax ? (s.sgn > 0 ? 0 : Math.PI) : (s.sgn > 0 ? -Math.PI / 2 : Math.PI / 2));
    m.compose(p.set(s.x + (s.ax ? 0 : s.sgn * (OUT - 0.05)), 1.95, -(s.y + (s.ax ? s.sgn * (OUT - 0.05) : 0))), qs, one); signs.setMatrixAt(si++, m);
  }
  const grp = new THREE.Group(); grp.name = 'edgeclose';
  for (const im of [boards, legs, signs]) { im.instanceMatrix.needsUpdate = true; im.castShadow = im !== signs; im.receiveShadow = true; im.computeBoundingSphere(); grp.add(im); }
  game.world.scene.add(grp);
  console.log('[edgeclose] ' + sites.length + ' roads closed at the map edge, ' + units + ' barricades');
  return (game.__edgeclose = { sites: sites.length, units, group: grp, list: sites });
}
