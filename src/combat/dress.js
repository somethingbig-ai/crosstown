// combat/dress.js: clothing of our own on the player, hung from bones (nothing is fetched). A six-panel cloth baseball cap over the hair:
// the kit figure's hair shell reads as a helmet from behind the shoulder, which is where the aim camera sits. Drawn here: the woven
// cloth, the panel seams with their stitching, the eyelets and the sweatband are one small canvas used as colour and as bump.
//   ?cap=0 off    ?capr=<crown radius m>  ?capy=<height of the crown's centre above the head bone m>  ?capx=<forward of it m>  ?capc=<hex colour>
// Also: a little life for the player's own jacket material (a tweak at load, the people lane's asset is not touched).
import * as THREE from 'three';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
function clothMaps(base) {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), b = document.createElement('canvas'); b.width = W; b.height = H; const y = b.getContext('2d');
  const col = new THREE.Color(base).convertLinearToSRGB(), css = (k) => `rgb(${Math.round(Math.min(1, col.r * k) * 255)},${Math.round(Math.min(1, col.g * k) * 255)},${Math.round(Math.min(1, col.b * k) * 255)})`;
  x.fillStyle = css(1); x.fillRect(0, 0, W, H); y.fillStyle = '#808080'; y.fillRect(0, 0, W, H);
  // twill weave: fine diagonal ribs, slightly uneven dye
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = -H; i < W; i += 3) { const k = 0.9 + r() * 0.22; x.strokeStyle = css(k); x.lineWidth = 1; x.beginPath(); x.moveTo(i, 0); x.lineTo(i + H, H); x.stroke(); y.strokeStyle = `rgb(${150 + r() * 30 | 0},${150},${150})`; y.beginPath(); y.moveTo(i, 0); y.lineTo(i + H, H); y.stroke(); }
  for (let i = 0; i < 900; i++) { x.fillStyle = css(0.8 + r() * 0.45); x.globalAlpha = 0.25; x.fillRect(r() * W, r() * H, 2 + r() * 5, 1 + r() * 2); } x.globalAlpha = 1;
  // six panels: a raised seam with a row of stitches each side; an eyelet in each panel; the band at the rim (v = 0 is the crown's top)
  for (let k = 0; k <= 6; k++) { const u = (k / 6) * W; x.fillStyle = css(0.55); x.fillRect(u - 1.5, 0, 3, H); y.fillStyle = '#e8e8e8'; y.fillRect(u - 4, 0, 8, H); y.fillStyle = '#404040'; y.fillRect(u - 1, 0, 2, H);
    for (const d of [-6, 6]) for (let v = 6; v < H; v += 9) { x.fillStyle = css(1.9); x.fillRect(u + d - 0.8, v, 1.6, 5); y.fillStyle = '#d0d0d0'; y.fillRect(u + d - 1, v, 2, 5); } }
  for (let k = 0; k < 6; k++) { const u = ((k + 0.5) / 6) * W, v = H * 0.3; x.fillStyle = css(0.35); x.beginPath(); x.arc(u, v, 4, 0, 7); x.fill(); x.strokeStyle = css(1.7); x.lineWidth = 1.5; x.beginPath(); x.arc(u, v, 5.5, 0, 7); x.stroke(); y.fillStyle = '#202020'; y.beginPath(); y.arc(u, v, 4, 0, 7); y.fill(); }
  for (const v of [H - 30, H - 6]) for (let u = 0; u < W; u += 9) { x.fillStyle = css(1.8); x.fillRect(u, v, 5, 1.6); y.fillStyle = '#d0d0d0'; y.fillRect(u, v, 5, 2); }
  const map = new THREE.CanvasTexture(c), bump = new THREE.CanvasTexture(b); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = bump.wrapS = THREE.RepeatWrapping; map.anisotropy = bump.anisotropy = 8; return { map, bump };
}
export class Cap {
  constructor(scene, P) {
    this.on = P.get('cap') === '1';      /* off unless ?cap=1: bare-headed the figure's own hair reads better from the lower aim camera than any cap did at tile size (stills out/v2.jpg) */ this.r = +(P.get('capr') || 0.118); this.y = +(P.get('capy') || 0.078); this.x = +(P.get('capx') || 0.012);
    const r = this.r, g = (this.group = new THREE.Group()); g.name = 'player_cap'; g.visible = false; const base = parseInt(P.get('capc') || '0b1019', 16);
    let maps = { map: null, bump: null }; try { maps = clothMaps(base); } catch (e) { maps = { map: null, bump: null }; }
    const cloth = new THREE.MeshStandardMaterial({ color: maps.map ? 0xffffff : base, map: maps.map, bumpMap: maps.bump, bumpScale: 0.35, roughness: 0.93, metalness: 0 });
    const flat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }), under = new THREE.MeshStandardMaterial({ color: new THREE.Color(base).multiplyScalar(0.45), roughness: 1, metalness: 0, side: THREE.DoubleSide });
    // forward is +x, up +y (the figure's own frame). The crown: a part sphere, a little long front to back, flattened on top, the front panels standing taller
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), cloth); dome.scale.set(1.08, 0.86, 0.94);
    { const p = dome.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), f = Math.max(0, X / r), up = Math.max(0, Y / r); p.setXYZ(i, X * (1 + 0.05 * f * (1 - up)), Y * (1 + 0.1 * f * f) - 0.006 * Math.cos(Math.atan2(Z, X) * 6) * Math.sin(Math.acos(Math.min(1, up))) * 0.5, Z); } dome.geometry.computeVertexNormals(); } g.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.955, r * 0.94, 0.02, 36, 1, true), under); band.scale.set(1.08, 1, 0.94); band.position.y = -r * 0.86 * Math.cos(Math.PI * 0.4) + 0.004; g.add(band);
    // the brim: a curved bill, rounded in front, drooping at the sides, with a thickness and a darker underside, rows of stitching on top
    const bill = (dy, mat) => { const gm = new THREE.PlaneGeometry(1, 1, 16, 6), p = gm.attributes.position, L = r * 0.78; for (let i = 0; i < p.count; i++) { const s = p.getX(i) * 2, t = p.getY(i) + 0.5, a = s * 0.8, rad = r * 1.0 + t * L * (1 - 0.45 * s * s); p.setXYZ(i, Math.cos(a) * rad * 1.06 - r * 0.08, dy - 0.022 * s * s - t * 0.012 * (1 + 0.5 * s * s), Math.sin(a) * rad * 0.9); } gm.computeVertexNormals(); { const nn = gm.attributes.normal; if (nn.getY(Math.floor(nn.count / 2)) < 0) { const ix = gm.index.array; for (let i = 0; i < ix.length; i += 3) { const q = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = q; } gm.computeVertexNormals(); } } const m = new THREE.Mesh(gm, mat); m.position.y = -r * 0.27; return m; };
    const billTex = flat;
    g.add(bill(0.004, billTex), bill(-0.002, billTex));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 6), flat); top.scale.y = 0.55; top.position.y = r * 0.9; g.add(top);
    g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }); scene.add(g);
  }
  // after the figure is posed: sit on the head, turned and tipped with it
  update(rig, show = true) {
    const h = rig && rig.B && rig.B.head; if (!this.on || !h || !rig.headRel || !show) { this.group.visible = false; return; }
    h.getWorldPosition(_p); h.getWorldQuaternion(_q).multiply(_q2.copy(rig.headRel).invert());      // the head's turn in the figure's frame
    this.group.quaternion.copy(_q); this.group.position.copy(_p).addScaledVector(_v.set(0, 1, 0).applyQuaternion(_q), this.y).addScaledVector(_v.set(1, 0, 0).applyQuaternion(_q), this.x); this.group.visible = true;
  }
}

// The player's own jacket, trousers and skin, as copies of the export's materials (the people lane's asset is not touched; other figures keep
// theirs): the jacket's albedo is near black, so its baked fold normals take no light and it reads as a flat cut-out from behind the shoulder.
// Lighter cloth, deeper folds, a little less rough.   ?jk=<jacket colour gain, default 2.6>  ?jn=<normal-map gain, default 1.9>  ?jk=1&jn=1 = as exported
export function dressPlayer(vis, P) {
  const out = { tops: [], skin: [] }; if (!vis || !vis.object) return out;
  const k = +(P.get('jk') || 3.2), ns = +(P.get('jn') || 1.9);
  vis.object.traverse((o) => {
    if (!o.isMesh || !o.material || Array.isArray(o.material)) return; const n = o.material.name || '';
    if (/^(top|pants)_/.test(n)) { const m = o.material.clone(); m.name = n; if (/^top_/.test(n)) m.color.multiplyScalar(k); if (m.normalMap && m.normalScale) m.normalScale.multiplyScalar(ns); m.roughness = 0.76; o.material = m; out.tops.push(m); }
    else if (/^skin_/.test(n)) { const m = o.material.clone(); m.name = n; m.roughness = 0.64; o.material = m; out.skin.push(m); }
  });
  return out;
}
