// windsock.js: a windsock at the edge of each rooftop helipad (every real roof pad has one: ref/wash pad_03, pad_04). It is the one thing on a
// clean roof that shows the air: it hangs limp in calm, lifts and swings with the wind, and stands out stiff and fluttering, pointing away from
// the aircraft, when the rotor's outwash reaches it. A steel pole with a swivel hoop and a tapered orange-and-white sleeve; the sleeve is bent
// in its vertex shader from one uniform (the air's direction and strength at the hoop), so it costs one small draw call each, and only the
// socks near the camera are updated or drawn.
import * as THREE from 'three';

const POLE = 3.3, LEN = 1.9, R0 = 0.23, R1 = 0.11, NU = 14, NA = 12;
const _v = { x: 0, y: 0, z: 0 }, _p = new THREE.Vector3();

function sleeveGeometry() {
  const P = [], C = [], I = [];
  for (let j = 0; j <= NU; j++) { const u = j / NU, band = Math.min(4, Math.floor(u * 5)), o = band % 2 === 0;
    for (let i = 0; i <= NA; i++) { const a = i / NA * Math.PI * 2; P.push(Math.cos(a), Math.sin(a), u); if (o) C.push(0.86, 0.22, 0.03); else C.push(0.82, 0.8, 0.76); } }
  for (let j = 0; j < NU; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; I.push(a, b, b + 1, a, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  const n = new Float32Array(P.length); for (let i = 0; i < n.length; i += 3) n[i + 1] = 1; g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.5, 0), LEN + 0.5); return g;
}
function sleeveMaterial(uSock) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => { sh.uniforms.uSock = uSock;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n uniform vec4 uSock;      // the air at the hoop: direction x, z (unit); strength 0 limp .. 1 full; time\n vec3 sockP;')
      .replace('#include <beginnormal_vertex>', `
        float su = position.z, sk = uSock.z, st = uSock.w; vec2 sc = position.xy;
        float el0 = -(1.0 - sk) * 1.35, flut = 0.08 * sk * su * sin(st * 11.0 + su * 8.0);
        float el = el0 - 0.4 * su * (1.0 - 0.9 * sk) + flut, em = el0 - 0.2 * su * (1.0 - 0.9 * sk) + 0.5 * flut;      // it droops more toward its tail; em: the mean slope as far as here
        vec3 hd = vec3(uSock.x, 0.0, uSock.y), sd = vec3(-uSock.y, 0.0, uSock.x);
        vec3 dm = hd * cos(em) + vec3(0.0, sin(em), 0.0), dd = hd * cos(el) + vec3(0.0, sin(el), 0.0), n2 = cross(dd, sd);
        float sr = mix(${R0.toFixed(3)}, ${R1.toFixed(3)}, su * su * 0.6 + su * 0.4) * mix(1.0, mix(0.45, 1.0, sk), smoothstep(0.0, 0.25, su));                    // limp, the cloth falls in on itself behind the hoop
        sockP = dm * (${LEN.toFixed(2)} * su) + (sd * sc.x + n2 * sc.y) * sr + sd * (0.06 * sk * su * sin(st * 7.0 + su * 5.0));
        vec3 objectNormal = normalize(sd * sc.x + n2 * sc.y);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = sockP;'); };
  m.customProgramCacheKey = () => 'heliWindsock2';
  return m;
}

export class Windsocks {
  // pads: the helicopter's pads ({ x, y (map), z, roof }); top(x, y, probe): roof height at a map point; solids: the flight model's list of things not to fly through
  constructor(world, pads, top, solids) {
    this.world = world; this.socks = []; this.group = new THREE.Group(); this.group.name = 'heli_windsocks';
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.7 }), geo = sleeveGeometry();
    const pole = new THREE.CylinderGeometry(0.035, 0.05, POLE, 8); pole.translate(0, POLE / 2, 0);
    const foot = new THREE.CylinderGeometry(0.16, 0.2, 0.08, 10); foot.translate(0, 0.04, 0);
    const hoop = new THREE.TorusGeometry(R0, 0.012, 5, 16);
    for (const p of pads) {
      if (!p.roof) continue; let at = null;
      // on the roof, clear of the pad's circle, where the roof is level all round the foot
      for (let d = 10.5; d <= 13 && !at; d += 1.25) for (let k = 0; k < 16 && !at; k++) { const a = (p.h || 0) + 0.9 + k * Math.PI / 8, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; let ok = true;
        for (let q = 0; q < 5 && ok; q++) { const qx = x + (q ? Math.cos(q * 1.571) * 0.8 : 0), qy = y + (q ? Math.sin(q * 1.571) * 0.8 : 0); if (Math.abs(top(qx, qy, 1e4) - p.z) > 0.15) ok = false; }
        if (ok) at = [x, y]; }
      if (!at) continue;
      const u = { value: new THREE.Vector4(1, 0, 0, 0) }, g = new THREE.Group(); g.position.set(at[0], p.z, -at[1]);
      const pm = new THREE.Mesh(pole, steel), fm = new THREE.Mesh(foot, steel), hm = new THREE.Mesh(hoop, steel), sm = new THREE.Mesh(geo, sleeveMaterial(u));
      pm.castShadow = true; hm.position.set(0, POLE, 0); sm.position.set(0, POLE, 0); sm.receiveShadow = true; g.add(pm, fm, hm, sm);
      g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); }); g.updateMatrixWorld(true); this.group.add(g);
      this.socks.push({ g, u, hoop: hm, x: at[0], y: p.z + POLE, z: -at[1], dx: 1, dz: 0, k: 0 });
      if (solids) solids.push({ x: at[0], y: at[1], radius: 0.3, top: p.z + POLE + 0.3 });
    }
    this.group.matrixAutoUpdate = false; world.scene.add(this.group);
  }
  // every drawn frame. field: the wash (wash/field.js); wind(x, y, z) -> { x, y, z } m/s: the ambient wind at a point
  update(cam, dt, t, field, wind) {
    for (const s of this.socks) {
      const far = Math.abs(cam.position.x - s.x) + Math.abs(cam.position.y - s.y) + Math.abs(cam.position.z - s.z) > 420; s.g.visible = !far; if (far) continue;
      const w = wind(s.x, s.y, s.z); let ax = w.x, az = w.z;
      if (field.on) { field.vel(s.x, s.y, s.z, _v); const rx = s.x - field.cx, rz = s.z - field.cz, r = Math.hypot(rx, rz) || 1, lo = 0.9 * field.U * Math.exp(-Math.max(0, r / field.R - 1) / 2.2) * (Math.abs(s.y - 3.3 - field.cy) < 1.5 ? 1 : 0), hi = Math.hypot(_v.x, _v.z);      // the outwash rolls up as it runs out: at pole height it is gusty but there (the air model's layer alone is too thin here)
        if (lo > hi) { ax += rx / r * lo; az += rz / r * lo; } else { ax += _v.x; az += _v.z; } }
      const sp = Math.hypot(ax, az), k = Math.min(1, Math.max(0, (sp - 0.8) / 5.5)), e = Math.min(1, dt * (1.2 + sp * 0.5));      // it answers a strong wind at once, a light air lazily
      if (sp > 0.3) { s.dx += (ax / sp - s.dx) * e; s.dz += (az / sp - s.dz) * e; const l = Math.hypot(s.dx, s.dz) || 1; s.dx /= l; s.dz /= l; }
      s.k += (k - s.k) * Math.min(1, dt * 2.5);
      s.u.value.set(s.dx, s.dz, s.k, t);
      s.hoop.rotation.y = Math.atan2(s.dx, s.dz); s.hoop.updateMatrix(); s.hoop.updateMatrixWorld(true);       // the hoop swivels to face down the wind
    }
  }
}
