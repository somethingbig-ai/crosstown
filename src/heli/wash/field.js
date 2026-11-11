// field.js: the air a helicopter's rotor moves, as a velocity field the effects can ask about.
// The wake leaves the disc at about the induced speed, speeds up and narrows below it, and is carried back by the aircraft's own motion and the
// wind (so in forward flight it trails behind and, fast enough, never reaches the ground). Where it meets the surface it turns outward into a
// thin fast layer along the ground (a wall jet): fastest about one rotor radius from the centre, fading by three or four, thickening as it
// goes; in the hover the outer edge rolls up into a ring vortex, which is what lifts the dust into a doughnut round the aircraft.
import * as THREE from 'three';

const _n = new THREE.Vector3(), _h = new THREE.Vector3();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class WashField {
  constructor(R, hubY) {
    this.R = R; this.hubY = hubY; this.on = false;
    this.U = 0;                                  // peak speed of the air running out along the surface, m/s
    this.cx = 0; this.cy = 0; this.cz = 0;       // where the wake's centre line meets the surface (three.js world)
    this.h = 0;                                  // rotor hub above that point, m
    this.lx = 0; this.lz = 0; this.sk = 0;       // the wake's lean: horizontal part of its direction (and its length, 0 = straight down)
    this.hx = 0; this.hy = 0; this.hz = 0;       // hub
    this.hov = 1;
  }
  // f: the flight state; groundAt(x, z, yProbe): height of the roof or ground at a point
  update(f, groundAt) {
    const R = this.R; this.on = false; this.U = 0;
    _h.set(0, this.hubY, 0).applyQuaternion(f.quat).add(f.pos); this.hx = _h.x; this.hy = _h.y; this.hz = _h.z;
    if (f.nr < 0.3 || f.vi < 0.8 || f.thrust <= 0) return;
    _n.set(Math.sin(f.disc.lon), 0, Math.sin(f.disc.lat)); _n.y = Math.sqrt(Math.max(0.5, 1 - _n.x * _n.x - _n.z * _n.z)); _n.applyQuaternion(f.quat);
    const w = 1.7 * f.vi;
    let dx = f.wind.x - f.vel.x - _n.x * w, dy = f.wind.y - f.vel.y - _n.y * w, dz = f.wind.z - f.vel.z - _n.z * w;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= l; dy /= l; dz /= l;
    if (dy > -0.3) return;                       // the wake trails away behind and does not come down here
    let S = f.surface, t = (_h.y - S) / -dy, cx = _h.x + dx * t, cz = _h.z + dz * t;
    const S2 = groundAt(cx, cz, _h.y);
    if (S2 < _h.y - 1 && Math.abs(S2 - S) > 0.4) { S = S2; t = (_h.y - S) / -dy; cx = _h.x + dx * t; cz = _h.z + dz * t; }
    const k = clamp(1 - (t / (2 * R) - 0.7) / 2.3, 0, 1);       // full strength within a diameter, nothing above about three
    if (k <= 0) return;
    const U = 1.9 * f.vi * k * -dy; if (U < 1.5) return;
    this.on = true; this.U = U; this.cx = cx; this.cy = S; this.cz = cz; this.h = _h.y - S;
    this.lx = dx; this.lz = dz; this.sk = Math.sqrt(dx * dx + dz * dz); this.hov = 1 - Math.min(1, this.sk * 1.7);
  }
  // speed of the air along the surface at a point on it
  speedAt(x, z) {
    const rx = x - this.cx, rz = z - this.cz, r = Math.sqrt(rx * rx + rz * rz) + 1e-4, xr = r / this.R;
    const asym = Math.max(0.15, 1 + 1.3 * (rx * this.lx + rz * this.lz) / r);
    return this.U * (xr < 1 ? xr : Math.exp(-(xr - 1) / 1.3)) * asym;
  }
  // velocity of the wash at a point in the air (world axes), written to out.x, out.y, out.z
  vel(x, y, z, out) {
    const R = this.R, U = this.U, rx = x - this.cx, rz = z - this.cz, r = Math.sqrt(rx * rx + rz * rz) + 1e-4, ex = rx / r, ez = rz / r, hy = y - this.cy, xr = r / R;
    if (xr > 7 || hy > this.h + 2 * R || hy < -3) { out.x = out.y = out.z = 0; return; }
    const prof = xr < 1 ? xr : Math.exp(-(xr - 1) / 1.3), del = 0.12 * R + 0.18 * r, g = Math.exp(-(hy / del) * (hy / del));
    const asym = Math.max(0.15, 1 + 1.3 * (ex * this.lx + ez * this.lz));
    let ur = U * prof * g * asym, vy = 0;
    if (xr < 1.25 && hy < this.h) vy = -U * 0.55 * (1 - (xr / 1.25) * (xr / 1.25)) * Math.min(1, hy / del);      // the column itself
    // the ring vortex at the edge of the outwash: out along the ground, up at the outside, back in over the top
    const a = 0.75 * R, qx = (r - 2.3 * R) / a, qy = (hy - 0.55 * R) / a, sv = U * 0.3 * this.hov * Math.exp(0.5 - 0.5 * (qx * qx + qy * qy));
    ur -= qy * sv; vy += qx * sv;
    out.x = ex * ur; out.y = vy; out.z = ez * ur;
  }
}
