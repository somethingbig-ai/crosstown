// livery.js: paints the aircraft's one picture (paint scheme, lettering, wear, placards) on a canvas at load. Nothing here comes from
// a photograph: the operator "Crosstown Air" and every mark are made up. Layout numbers are shape.js's (AT, DECALS).
import { AT, atlasPx, DECALS, podSect } from './shape.js';

export const COL = { white: '#a6a6a2', navy: '#14264a', orange: '#e2701c', grey: '#8d9296' };

export function paintLivery(doc = document) {
  const c = doc.createElement('canvas'); c.width = AT.w; c.height = AT.h; const g = c.getContext('2d');
  const sx = AT.w / (AT.x1 - AT.x0), sy = (AT.h / 2) / (AT.y1 - AT.y0), H2 = AT.h / 2;
  let seed = 20261110; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const right of [true, false]) {
    const T = () => (right ? g.setTransform(sx, 0, 0, -sy, -AT.x0 * sx, AT.y1 * sy) : g.setTransform(-sx, 0, 0, -sy, AT.x1 * sx, AT.y1 * sy + H2));
    const px = (x, y) => atlasPx(x, y, right);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(0, right ? 0 : H2, AT.w, H2); g.clip();
    T(); g.fillStyle = COL.white; g.fillRect(AT.x0, AT.y0, AT.x1 - AT.x0, AT.y1 - AT.y0);
    // the scheme: navy belly sweeping up over the engine bay, an orange band riding its edge; white cabin top and boom; navy fin
    const edge = () => { g.moveTo(3.6, 0.90); g.lineTo(1.9, 0.955); g.bezierCurveTo(0.6, 0.99, -0.6, 1.0, -1.3, 1.1); g.bezierCurveTo(-2.0, 1.2, -2.6, 1.45, -3.6, 1.62); };
    g.lineJoin = 'round'; g.lineCap = 'butt';
    g.beginPath(); edge(); g.strokeStyle = COL.orange; g.lineWidth = 0.2; g.stroke();
    g.beginPath(); edge(); g.lineTo(-3.6, 0.3); g.lineTo(3.6, 0.3); g.closePath(); g.fillStyle = COL.navy; g.fill();
    // the tail: white fin with an orange tip and a navy foot, so it reads from above and behind against brick and asphalt
    g.beginPath(); g.moveTo(-6.3, 2.62); g.lineTo(-7.9, 2.62); g.lineTo(-7.9, 3.1); g.lineTo(-6.3, 3.1); g.closePath(); g.fillStyle = COL.orange; g.fill();
    g.beginPath(); g.moveTo(-6.3, 0.3); g.lineTo(-7.9, 0.3); g.lineTo(-7.9, 1.5); g.lineTo(-6.3, 1.5); g.closePath(); g.fillStyle = COL.navy; g.fill();
    g.beginPath(); g.moveTo(-6.3, 1.56); g.lineTo(-7.9, 1.56); g.strokeStyle = COL.orange; g.lineWidth = 0.07; g.stroke();
    g.fillStyle = COL.orange; g.fillRect(-6.36, 1.5, 0.1, 0.9);      // a band round the boom ahead of the tail rotor
    // lettering (drawn in picture pixels so it is never mirrored)
    const text = (str, x, y, h, col, o = {}) => { const p = px(x, y); g.setTransform(1, 0, 0, 1, 0, 0); g.font = `${o.style || 'italic 800'} ${Math.round(h * sy / 0.72)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; g.textAlign = o.align || 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = col; if (o.space && 'letterSpacing' in g) g.letterSpacing = o.space + 'px'; g.fillText(str, p[0], p[1]); if ('letterSpacing' in g) g.letterSpacing = '0px'; T(); };
    text('CROSSTOWN AIR', -4.72, 1.80, 0.165, COL.navy, { space: 4 });
    text('07', -7.03, 2.2, 0.26, COL.navy, { style: '800' });
    text('QX-07', -2.15, 1.7, 0.19, COL.navy, { style: '800', space: 3 });      // a registration-looking mark that is no country's: no nationality mark begins with Q
    text('CROSSTOWN AIR CHARTER', -1.27, 0.90, 0.04, COL.white, { style: '600', space: 2 });
    // a fuel filler ring on the left side
    if (!right) { g.beginPath(); g.arc(-1.08, 1.80, 0.075, 0, 7); g.strokeStyle = '#b3261b'; g.lineWidth = 0.014; g.stroke(); }
    // ---- wear, drawn over the paint
    // exhaust soot along the top of the boom, thick by the engine, thinning aft
    for (let i = 0; i < 260; i++) { const x0 = -2.95 - rnd() * 0.5, len = 0.6 + rnd() * 2.9, top = podSect(x0 - len * 0.5).yt, y = top + 0.05 - rnd() * rnd() * 0.3, h = 0.012 + rnd() * 0.05; const gr = g.createLinearGradient(x0, 0, x0 - len, 0); gr.addColorStop(0, 'rgba(22,19,16,0)'); gr.addColorStop(0.12, `rgba(22,19,16,${0.05 + rnd() * 0.05})`); gr.addColorStop(1, 'rgba(22,19,16,0)'); g.fillStyle = gr; g.fillRect(x0 - len, y - h, len, h); }
    // and round the jet pipe itself: the cowl's tail and the boom root are burnt brown-black
    for (let i = 0; i < 90; i++) { const x = -2.5 - rnd() * 1.1, y = 2.0 + rnd() * 0.5, r = 0.05 + rnd() * 0.16, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(30,24,19,${0.05 + rnd() * 0.07})`); gr.addColorStop(1, 'rgba(30,24,19,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
    // streaks under latches, vents, the fuel cap, hinges and the boom frames
    const streak = (x, y, len, w, a, col = '60,48,36') => { const gr = g.createLinearGradient(0, y, 0, y - len); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - w / 2, y - len, w, len); };
    for (const [x, y] of [[-1.5, 1.02], [-1.05, 1.02], [-1.08, 1.75], [1.75, 0.95], [1.58, 1.72], [0.2, 0.95], [-2.27, 2.2], [-1.6, 2.24], [-1.5, 2.24], [-1.43, 2.24], [-3.0, 1.9], [-4.42, 1.85], [-5.84, 1.9], [-0.85, 2.3]]) for (let i = 0; i < 5; i++) streak(x + (rnd() - 0.5) * 0.06, y, 0.1 + rnd() * 0.35, 0.006 + rnd() * 0.02, 0.05 + rnd() * 0.1);
    for (let i = 0; i < 140; i++) streak(-3 + rnd() * 6, 0.72 + rnd() * 0.5, 0.06 + rnd() * 0.25, 0.004 + rnd() * 0.012, 0.03 + rnd() * 0.06);
    // road film low on the belly and behind the cross tubes
    { const gr = g.createLinearGradient(0, 0.5, 0, 0.95); gr.addColorStop(0, 'rgba(70,62,52,0.34)'); gr.addColorStop(1, 'rgba(70,62,52,0)'); g.fillStyle = gr; g.fillRect(-3.2, 0.45, 6.7, 0.5); }
    // chips: bare primer and metal where boots, hands and grit land (door sills, hatch edges, the fin's leading edge, the nose)
    const chips = (x0, x1, y0, y1, n, s) => { for (let i = 0; i < n; i++) { const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), r = s * (0.3 + rnd()); g.fillStyle = rnd() < 0.5 ? 'rgba(150,156,150,0.9)' : 'rgba(96,100,104,0.9)'; g.beginPath(); g.ellipse(x, y, r * (0.6 + rnd()), r * (0.4 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill(); } };
    chips(0.3, 1.8, 0.74, 0.80, 70, 0.004); chips(-0.5, 0.2, 0.74, 0.80, 30, 0.004); chips(-1.74, -0.8, 0.98, 1.02, 30, 0.003); chips(-6.6, -6.48, 1.6, 2.5, 30, 0.003); chips(-2.9, 1.5, 0.52, 0.62, 60, 0.004);
    g.restore();
  }
  // ---- placards and stencils, in the spare picture space under the right side's boom
  g.setTransform(1, 0, 0, 1, 0, 0);
  const plac = (name, bg, fg, lines, o = {}) => {
    const [x, y, w, h] = DECALS[name]; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = bg; g.fillRect(x, y, w, h);
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = o.bw || 6; g.strokeRect(x + 5, y + 5, w - 10, h - 10); }
    const n = lines.length, lh = (h - 16) / n; g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((ln, i) => { const size = Math.min(lh * 0.78, o.max || 999); g.font = `700 ${Math.round(size * (o.sizes ? o.sizes[i] : 1))}px "Helvetica Neue", Helvetica, Arial, sans-serif`; let s = size; while (g.measureText(ln).width > w - 26 && s > 6) { s -= 1; g.font = `700 ${Math.round(s)}px "Helvetica Neue", Helvetica, Arial, sans-serif`; } g.fillText(ln, x + w / 2, y + 8 + lh * (i + 0.5) + 1); });
    // a sticker ages: scuffs and a dulled corner
    for (let i = 0; i < w * h / 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '235,232,225' : '60,56,50'},${0.05 + rnd() * 0.12})`; g.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 14, 1 + rnd() * 2); }
    g.restore();
  };
  plac('danger', '#b8261b', '#f3f1ea', ['DANGER', 'KEEP CLEAR OF TAIL ROTOR'], { border: '#f3f1ea', sizes: [1.15, 0.72] });
  plac('rescue', '#e3b10f', '#141414', ['EMERGENCY EXIT', 'TURN HANDLE · PUSH DOOR OUT'], { border: '#141414', bw: 4, sizes: [1, 0.7] });
  plac('handle', '#e9e7e0', '#141414', ['PULL TO OPEN  ▶'], { border: '#141414', bw: 3 });
  plac('nostep', '#e9e7e0', '#b8261b', ['NO STEP'], { border: '#b8261b', bw: 4 });
  plac('fuel', '#e9e7e0', '#141414', ['JET A-1 ONLY', 'USABLE 540 L · 143 US GAL'], { border: '#b8261b', sizes: [1, 0.62] });
  plac('baggage', '#e9e7e0', '#141414', ['BAGGAGE · MAX LOAD 100 KG'], { border: '#141414', bw: 3 });
  plac('static', '#e9e7e0', '#b8261b', ['STATIC PORT', 'KEEP CLEAR'], { border: '#b8261b', bw: 3 });
  plac('ground', '#e9e7e0', '#141414', ['GROUND HERE'], { border: '#141414', bw: 3 });
  plac('hoist', '#e3b10f', '#141414', ['HOIST', 'POINT'], {});
  plac('jack', '#e3b10f', '#141414', ['JACK', 'HERE'], {});
  return c;
}
