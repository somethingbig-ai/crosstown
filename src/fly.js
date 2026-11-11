// fly.js: free flight over the city (V). WASD moves along the view, mouse looks (click to capture it; arrow keys also turn), SPACE up, SHIFT down,
// scroll or [ ] changes speed. The game goes on underneath; V again drops back to the player.
import * as THREE from 'three';
import { clamp } from './geo.js';

export class Fly {
  constructor(game) {
    this.g = game; this.on = false; this.x = 0; this.y = 0; this.z = 300; this.yaw = 0; this.pitch = -0.5; this.speed = 160; this._f = new THREE.Vector3();
    addEventListener('wheel', (e) => { if (!this.on) return; this.speed = clamp(this.speed * Math.pow(1.0015, -e.deltaY), 4, 1500); e.preventDefault(); }, { passive: false });
    addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat) this.toggle(); if (!this.on) return; if (e.code === 'BracketRight' || e.code === 'Equal') this.speed = clamp(this.speed * 1.5, 4, 1500); if (e.code === 'BracketLeft' || e.code === 'Minus') this.speed = clamp(this.speed / 1.5, 4, 1500); });
  }
  toggle() {
    const g = this.g; this.on = !this.on;
    if (this.on) {   // start high and a little behind, looking down over the district
      const C = g.cam; this.yaw = C.yaw; this.pitch = -0.62; this.z = 320; this.x = clamp(C.tx - Math.cos(C.yaw) * 380, -900, 900); this.y = clamp(C.ty - Math.sin(C.yaw) * 380, -900, 900); this.speed = 160;
    } else { g.snapCamera(); }
  }
  look(dx, dy) { this.yaw -= dx * 0.0026; this.pitch = clamp(this.pitch - dy * 0.0022, -1.5, 1.2); }
  // real seconds, once per drawn frame: move, place the camera, return the point the sun-shadow box should follow
  update(el) {
    const g = this.g, K = g.keys, cam = g.world.camera; const ax = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0);
    this.look(ax('ArrowRight', 'ArrowLeft') * 520 * el, ax('ArrowDown', 'ArrowUp') * 420 * el);
    const f = ax('KeyW', 'KeyS'), s = ax('KeyD', 'KeyA'), u = (K.has('Space') ? 1 : 0) - (K.has('ShiftLeft') || K.has('ShiftRight') ? 1 : 0);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), d = this.speed * Math.min(el, 0.1);
    this.x += (cy * cp * f + sy * s) * d; this.y += (sy * cp * f - cy * s) * d; this.z = clamp(this.z + (sp * f + u) * d, 1.2, 2500);
    const lim = g.city.meta.hx + 1500; this.x = clamp(this.x, -lim, lim); this.y = clamp(this.y, -lim, lim);
    cam.position.set(this.x, this.z, -this.y); cam.lookAt(this.x + cy * cp * 10, this.z + sp * 10, -(this.y + sy * cp * 10));
    const fov = this.fov || 60; if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }     // this.fov: set by the photo-spot capture (tools/linkspot.mjs)
    // where the view meets the street (or straight below, when looking at the horizon)
    const t = sp < -0.05 ? Math.min(this.z / -sp, 900) : 0;
    return this._f.set(this.x + cy * cp * t, 0, -(this.y + sy * cp * t));
  }
}
