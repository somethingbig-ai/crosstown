// gps/line.js (progress lane, GPS): the route drawn on the road in the world, and the waypoint's marker.
// One ribbon mesh, about 300 m of it ahead of the player, lying on the roadway in the lane side the route drives (centre of a one-way street, the
// right half of a two-way one), curved through each junction. A soft continuous band with chevrons pointing the way, so it reads as a line at speed
// and as arrows when slow. Unlit and half transparent (the road shows through; it takes no light and casts none), depth-tested, so buildings and cars hide it
// as they hide the road. Cost: one draw call, at most 2 x MAXP vertices rewritten per frame while a waypoint is set; nothing at all when none is.
import * as THREE from 'three';
import { roadLine, routeLeft } from './route.js';

const MAXP = 150, STEP = 2.2, WINDOW = 300, TILE = 5.5;      // points, metres between them, metres of line ahead, metres per chevron

export class WorldLine {
  constructor(game, opt = {}) {
    this.g = game; const k = opt.k || 1, w = (this.w = opt.width || 1.5);
    // the picture: a band the full width at low alpha, one chevron on it; mip-mapped so it turns into an even line far away
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const x = cv.getContext('2d');
    x.clearRect(0, 0, 64, 256); const grd = x.createLinearGradient(0, 0, 64, 0); grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.16, 'rgba(255,255,255,0.42)'); grd.addColorStop(0.84, 'rgba(255,255,255,0.42)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 64, 256);
    x.fillStyle = 'rgba(255,255,255,1)'; x.beginPath(); x.moveTo(32, 62); x.lineTo(56, 150); x.lineTo(56, 196); x.lineTo(32, 108); x.lineTo(8, 196); x.lineTo(8, 150); x.closePath(); x.fill();
    const tex = (this.tex = new THREE.CanvasTexture(cv)); tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8; tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    const col = new THREE.Color(opt.color || '#5cc8ff').multiplyScalar(k);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, opacity: opt.opacity || 0.8, vertexColors: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    const geo = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(MAXP * 2 * 3); this.uv = new Float32Array(MAXP * 2 * 2); this.colr = new Float32Array(MAXP * 2 * 4).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('color', new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array((MAXP - 1) * 6); for (let i = 0; i < MAXP - 1; i++) { const a = i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); } geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3; this.mesh.visible = false; this.mesh.name = 'gps_line'; this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.matrixAutoUpdate = false;
    // the waypoint: a ring on the road and a thin column of light over it (short when seen from high up, as the job marker is)
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 40, 1, true), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.5), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7, 12, 1, true), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.2), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    ring.position.y = 0.2; this.ring = ring; this.beam = beam; this.marker = new THREE.Group(); this.marker.add(ring, beam); this.marker.visible = false; this.marker.name = 'gps_marker';
    game.world.scene.add(this.mesh, this.marker);
    this.buf = new Float32Array(MAXP * 2); this.n = 0;
    const R = game.roads; this.off = (e, dir) => (e.oneway ? 0 : R.laneCount(e, dir) * e.lw * 0.5);
  }
  hide() { this.mesh.visible = false; this.marker.visible = false; }
  // route: the gps route; T: the target; lead: metres ahead of the player where the line begins; t: seconds (for the ring's pulse)
  update(route, T, lead, t) {
    const g = this.g, m = this.marker;
    m.visible = !!T; if (T) { const cy = g.world.camera.position.y, hgt = cy > 45 ? 7 : cy > 20 ? 7 + (45 - cy) * 1.3 : 34; this.beam.scale.y = hgt / 7; this.beam.position.y = hgt / 2; m.position.set(T.x, 0.1, -T.y); this.ring.material.opacity = 0.4 + 0.15 * Math.sin(t * 3.5); }
    if (!route) { this.mesh.visible = false; return; }
    const left = routeLeft(route), n = roadLine(g.roads, route, this.off, lead, WINDOW, STEP, this.buf), atEnd = roadLine.atEnd, B = this.buf, P = this.pos, U = this.uv, C = this.colr, hw = this.w / 2;
    this.n = n; if (n < 2) { this.mesh.visible = false; return; }
    let d = lead;
    for (let i = 0; i < n; i++) {
      const x = B[i * 2], y = B[i * 2 + 1], i0 = i > 0 ? i - 1 : 0, i1 = i < n - 1 ? i + 1 : n - 1; let tx = B[i1 * 2] - B[i0 * 2], ty = B[i1 * 2 + 1] - B[i0 * 2 + 1]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      if (i > 0) d += Math.hypot(x - B[i * 2 - 2], y - B[i * 2 - 1]);
      const nx = -ty * hw, ny = tx * hw, o = i * 6;     // left of travel, then right; map (x, y) -> scene (x, h, -y)
      P[o] = x + nx; P[o + 1] = 0.06; P[o + 2] = -(y + ny); P[o + 3] = x - nx; P[o + 4] = 0.06; P[o + 5] = -(y - ny);
      const v = (d - left) / TILE, q = i * 4;      /* fixed to the ground (counted from the route's end), rising along the drive: the chevrons point the way */ U[q] = 0; U[q + 1] = v; U[q + 2] = 1; U[q + 3] = v;
      const a = Math.min(1, (d - lead) / 9 + 0.05) * (atEnd ? 1 : Math.min(1, Math.max(0, (lead + WINDOW - d) / 80))), c = i * 8; C[c + 3] = a; C[c + 7] = a;
    }
    const geo = this.geo; geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.setDrawRange(0, (n - 1) * 6); this.mesh.visible = true;
  }
}
