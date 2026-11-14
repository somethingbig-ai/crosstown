// hud.js: everything on screen that is not the world, drawn on one 2D canvas (so a capture can composite it).
import { clamp } from './geo.js';

const AMBER = '#ffb82e', INK = 'rgba(12,13,15,0.78)';
export class Hud {
  constructor(game) {
    this.g = game; const c = (this.canvas = document.createElement('canvas')); c.id = 'hudc';
    Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none' }); document.body.appendChild(c);
    this.ctx = c.getContext('2d'); this.w = 0; this.h = 0; this.mapR = 118; this.street = ''; this.streetT = 0;
    // the map, drawn once to an offscreen canvas in map metres (4 px per 5 m), rotated and clipped per frame
    const city = game.city, hx = city.meta.hx, hy = city.meta.hy, S = (this.mapS = 0.8), m = (this.map = document.createElement('canvas')); m.width = Math.ceil(hx * 2 * S); m.height = Math.ceil(hy * 2 * S);
    const x = m.getContext('2d'); x.fillStyle = '#3d4148'; x.fillRect(0, 0, m.width, m.height);
    const P = (p) => [(p[0] + hx) * S, (hy - p[1]) * S];
    x.fillStyle = '#1b1d21';
    for (const b of city.blocks) { x.beginPath(); for (const ring of [b.ext, ...b.holes]) { ring.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.closePath(); } x.fill('evenodd'); }
    x.fillStyle = '#24352a'; for (const b of city.parks) { x.beginPath(); b.ext.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.closePath(); x.fill(); }
    x.fillStyle = '#272a2f'; for (const b of city.buildings) { if (b.minh > 0) continue; x.beginPath(); b.poly.forEach((p, i) => { const q = P(p); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.closePath(); x.fill(); }
    this.hx = hx; this.hy = hy;
  }
  fit() {
    // the HUD is drawn at the screen's own resolution, not the 3D picture's (which the game shrinks to hold frame rate: text came out soft and blocky)
    const main = this.g.world.renderer.domElement, dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(2, Math.round((main.clientWidth || main.width) * dpr)), h = Math.max(2, Math.round((main.clientHeight || main.height) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.w = w; this.h = h; this.k = h / 1080;
  }
  text(s, x, y, size, color = '#fff', align = 'left', weight = 600, track = 0) {
    const c = this.ctx; c.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; c.textAlign = align; c.textBaseline = 'alphabetic'; c.fillStyle = color;
    if ('letterSpacing' in c) c.letterSpacing = track + 'px'; c.fillText(s, x, y);
  }
  panel(x, y, w, h, r = 8) { const c = this.ctx; c.fillStyle = INK; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); }
  wrap(s, maxW, size, weight = 500) { const c = this.ctx; c.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`; const words = s.split(' '), lines = []; let cur = ''; for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; }

  draw() {
    this.fit(); const c = this.ctx, g = this.g, k = this.k, W = this.w / k, H = 1080, pl = g.player, M = g.missions;
    c.setTransform(k, 0, 0, k, 0, 0); c.clearRect(0, 0, W, H);
    c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 6;
    // ---- job card, top left
    const T = M.target; let title = '', sub = '';
    if (M.state === 'start') { title = 'Get in the car'; sub = 'Red coupe, by Madison Square Park'; }
    else if (M.state === 'pickup') { title = 'Collect the package'; sub = T ? T.name : ''; }
    else if (M.state === 'deliver') { title = 'Deliver the package'; sub = T ? T.name : ''; }
    else if (M.state === 'wait') { title = 'Stand by'; sub = 'Vee is lining up the next job'; }
    c.shadowBlur = 0; this.panel(36, 34, 430, 92); c.fillStyle = AMBER; c.fillRect(36, 34, 5, 92);
    this.text('JOB ' + String(M.jobN + 1).padStart(2, '0'), 58, 60, 13, AMBER, 'left', 700, 2.5);
    this.text(title, 58, 88, 25, '#fff', 'left', 700); this.text(sub + (T && M.dist !== undefined && M.state !== 'wait' ? '  ·  ' + (M.dist < 950 ? Math.round(M.dist / 5) * 5 + ' m' : (M.dist / 1000).toFixed(1) + ' km') : ''), 58, 112, 16, 'rgba(255,255,255,0.72)', 'left', 500);
    // ---- cash, top right
    this.panel(W - 216, 34, 180, 52); this.text('$' + g.cash.toLocaleString('en-US'), W - 54, 70, 28, '#fff', 'right', 700);
    // ---- timer, top centre
    if (M.state === 'deliver') {
      const t = Math.max(0, M.timer), low = t < 15; this.panel(W / 2 - 92, 34, 184, 64);
      this.text(Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'), W / 2, 80, 40, low && Math.floor(t * 2) % 2 ? '#ff5a45' : '#fff', 'center', 700, 1);
      c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(W / 2 - 76, 88, 152, 3); c.fillStyle = low ? '#ff5a45' : AMBER; c.fillRect(W / 2 - 76, 88, 152 * clamp(t / M.timer0, 0, 1), 3);
    }
    // ---- speed and street, bottom left
    const v = pl.vehicle; this.streetT -= 1; if (this.streetT <= 0) { this.streetT = 20; let ne = g.roads.nearestEdge(pl.x, pl.y, 45); if (ne && !ne.e.name) { let b = null; for (const e of g.roads.edges) { if (!e.name) continue; const pr = e.line.project(pl.x, pl.y); if (pr.d < 60 && (!b || pr.d < b.d)) b = { e, d: pr.d }; } ne = b; } if (ne && ne.e.name) this.street = ne.e.name.replace('Avenue', 'Ave').replace('Street', 'St').replace('East ', 'E ').replace('West ', 'W '); }
    if (v) { const mph = Math.round(Math.abs(v.vf) * 2.237); this.panel(36, H - 132, 232, 98); this.text(String(mph), 150, H - 62, 62, '#fff', 'right', 700); this.text('MPH', 160, H - 62, 15, AMBER, 'left', 700, 2); this.text(this.street.toUpperCase(), 58, H - 106, 13, 'rgba(255,255,255,0.75)', 'left', 600, 2); }
    else { this.panel(36, H - 78, 232, 44); this.text(this.street.toUpperCase(), 58, H - 50, 14, 'rgba(255,255,255,0.8)', 'left', 600, 2); }
    // ---- map, bottom right
    this.drawMap(W - 36 - this.mapR, H - 36 - this.mapR);
    // ---- dispatcher line, bottom centre
    if (M.msg) { const a = clamp(Math.min(M.msg.t * 3, (7 - M.msg.t) * 2), 0, 1), lines = this.wrap(M.msg.text, 760, 22); c.globalAlpha = a; const bh = lines.length * 30 + 22; this.panel(W / 2 - 410, H - 64 - bh, 820, bh, 6); lines.forEach((l, i) => this.text(l, W / 2, H - 64 - bh + 34 + i * 30, 22, '#fff', 'center', 500)); c.globalAlpha = 1; }
    // ---- prompts
    if (g.heli) g.heli.drawHud(this);     // heli lane
    if (!v && !g.demo && !(g.heli && (g.heli.piloted || g.heli.canBoard()))) { const n = g.nearestCar(); if (n) { this.panel(W / 2 - 110, H * 0.62, 220, 44, 22); this.text('F', W / 2 - 78, H * 0.62 + 30, 20, AMBER, 'center', 800); this.text('Get in', W / 2 + 8, H * 0.62 + 30, 20, '#fff', 'center', 600); } }
    if (g.fly && g.fly.on) { this.panel(W / 2 - 560, H - 58, 1120, 40, 6); this.text('FLY   WASD  move     MOUSE  look (click first)     SPACE  up     SHIFT  down     SCROLL or [ ]  speed ' + Math.round(g.fly.speed) + ' m/s     V  back to the street', W / 2, H - 32, 15, '#fff', 'center', 600, 1); }
    else if (!g.capture && (g.t < 14 || g.demo)) { c.globalAlpha = g.demo ? 0.85 : clamp(14 - g.t, 0, 1); this.text('V  fly over the city', W / 2, H - 52, 14, '#ffb82e', 'center', 700, 1.5); c.globalAlpha = 1; }
    if (g.t < 14 && !g.demo && !g.capture && !(g.fly && g.fly.on)) { c.globalAlpha = clamp(14 - g.t, 0, 1); this.text('WASD  drive / walk     SPACE  ' + (g.player && g.player.vehicle ? 'handbrake' : 'jump') + '     F  in / out     SHIFT  run     MOUSE  look     V  fly     M  sound', W / 2, H - 28, 14, 'rgba(255,255,255,0.8)', 'center', 600, 1.5); c.globalAlpha = 1; }
    // ---- banner
    if (M.banner) { const b = M.banner, a = clamp(Math.min(b.t * 2.5, (4.5 - b.t) * 2), 0, 1); c.globalAlpha = a; c.fillStyle = 'rgba(8,9,10,0.62)'; c.fillRect(0, H * 0.36, W, 150);
      this.text(b.title, W / 2, H * 0.36 + 76, 62, b.bad ? '#ff5a45' : AMBER, 'center', 800, 10); this.text(b.sub, W / 2, H * 0.36 + 120, 28, '#fff', 'center', 600, 2); c.globalAlpha = 1; }
    if (g.demo) this.text('AUTOPILOT DEMO', 36, H - (v ? 146 : 92), 12, 'rgba(255,255,255,0.55)', 'left', 700, 3);
    if (g.P.has('fps') && g.fps) this.text(g.fps.toFixed(0) + ' fps', W - 40, 112, 14, 'rgba(255,255,255,0.7)', 'right', 600);
    if (g.paused) { c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, 0, W, H); this.text('PAUSED', W / 2, H / 2, 54, '#fff', 'center', 800, 12); }
  }

  drawMap(cx, cy) {
    const c = this.ctx, g = this.g, R = this.mapR, pl = g.player, S = this.mapS, zoom = 1.25, yaw = g.cam.yaw, M = g.missions;
    c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 7); c.clip(); c.fillStyle = '#16181b'; c.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    c.translate(cx, cy); c.rotate(yaw - Math.PI / 2); c.scale(zoom / S, zoom / S); c.translate(-(pl.x + this.hx) * S, -(this.hy - pl.y) * S);
    c.imageSmoothingEnabled = true; c.drawImage(this.map, 0, 0);
    const P = (x, y) => [(x + this.hx) * S, (this.hy - y) * S];
    if (M.route && M.target) {     // the drive still to do: from the car, along the blocks ahead, to the stop
      const r = M.route, last = r.segs.length - 1, q0 = P(pl.x, pl.y); c.strokeStyle = AMBER; c.lineWidth = 5 * S; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); c.moveTo(q0[0], q0[1]);
      r.segs.forEach((sg, i) => { const ln = sg.dir > 0 ? sg.e.line : sg.e.rev, from = i === 0 ? r.s0 : 0, to = i === last && r.end ? r.end.s : ln.len;
        for (let j = 0; j < ln.p.length; j++) { if (ln.cum[j] <= from + 1 || ln.cum[j] >= to) continue; const q = P(ln.p[j][0], ln.p[j][1]); c.lineTo(q[0], q[1]); }
        if (i === last) { const e = ln.at(to, {}), q = P(e.x, e.y); c.lineTo(q[0], q[1]); } });
      const qt = P(M.target.x, M.target.y); c.lineTo(qt[0], qt[1]); c.stroke(); }
    for (const t of g.traffic.cars) { const q = P(t.x, t.y); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); }
    c.restore();
    // target marker, clamped to the rim
    if (M.target) { const dx = M.target.x - pl.x, dy = M.target.y - pl.y, a = yaw - Math.PI / 2; let mx = (dx * Math.cos(a) + dy * Math.sin(a)) * zoom, my = (dx * Math.sin(a) - dy * Math.cos(a)) * zoom; const d = Math.hypot(mx, my); if (d > R - 10) { mx *= (R - 10) / d; my *= (R - 10) / d; }
      c.fillStyle = AMBER; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.arc(cx + mx, cy + my, 7, 0, 7); c.fill(); c.stroke(); }
    // player arrow (the map turns with the camera, the arrow shows the heading relative to it)
    c.save(); c.translate(cx, cy); c.rotate(-(pl.h - yaw)); c.fillStyle = '#fff'; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -11); c.lineTo(7.5, 8); c.lineTo(0, 4); c.lineTo(-7.5, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2.5; c.beginPath(); c.arc(cx, cy, R, 0, 7); c.stroke();
    // north tick
    const na = yaw - Math.PI / 2, nx = cx + Math.sin(na) * R, ny = cy - Math.cos(na) * R;
    c.fillStyle = '#16181b'; c.beginPath(); c.arc(nx, ny, 11, 0, 7); c.fill(); this.text('N', nx, ny + 5, 13, '#fff', 'center', 800);
  }
}
