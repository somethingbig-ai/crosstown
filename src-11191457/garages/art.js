// garages/art.js (lanes/shops/garages): the garage's lettering, painted on one 1024 x 1024 canvas at load. Every word is invented or generic: no
// operator's name, no logo. CELLS: name -> [x, y, w, h] in canvas pixels.
export const CELLS = {
  blade: [0, 0, 160, 640], rates: [176, 0, 360, 600], arrow: [560, 0, 128, 330], pay: [704, 0, 300, 100], mph: [704, 116, 160, 200],
  band: [0, 656, 1024, 154], level1: [0, 826, 256, 128], level2: [272, 826, 256, 128], exit: [544, 826, 300, 90], up: [0, 960, 256, 64], clear: [272, 968, 600, 32],
};
const YEL = '#f2bc10', BLK = '#111111', BLUE = '#1c3f73', WHITE = '#f4f2ea', GREEN = '#0d6b3a', RED = '#b3160f';
const F = (px, w = 800) => w + ' ' + px + 'px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

export function paintGarageAtlas() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1024; const g = cv.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
  const cell = (name, bg) => { const [x, y, w, h] = CELLS[name]; if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); } return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }; };
  const text = (s, x, y, px, colr, wt, maxw) => { g.font = F(px, wt); g.fillStyle = colr; g.fillText(s, x, y, maxw); };
  // the blade: PARK down a yellow board, black border
  { const c = cell('blade', BLK); g.fillStyle = YEL; g.fillRect(c.x + 8, c.y + 8, c.w - 16, c.h - 16);
    'PARK'.split('').forEach((ch, i) => text(ch, c.cx, c.y + 80 + i * 122, 130, BLK, 900));
    g.fillStyle = BLK; g.fillRect(c.x + 20, c.y + 536, c.w - 40, 84); text('24 HR', c.cx, c.y + 580, 50, YEL, 800, c.w - 50); }
  // the rate board
  { const c = cell('rates', WHITE); g.fillStyle = BLUE; g.fillRect(c.x, c.y, c.w, 92); text('PARKING RATES', c.cx, c.y + 48, 46, WHITE, 800, c.w - 20);
    const rows = [['UP TO 1/2 HOUR', '$9'], ['UP TO 1 HOUR', '$17'], ['UP TO 2 HOURS', '$26'], ['UP TO 10 HOURS', '$38'], ['MAX TO 24 HOURS', '$52'], ['EVENINGS AFTER 6', '$22']];
    rows.forEach((r, i) => { const y = c.y + 136 + i * 56; g.textAlign = 'left'; text(r[0], c.x + 18, y, 30, BLK, 700, 220); g.textAlign = 'right'; text(r[1], c.x + c.w - 18, y, 40, RED, 900); g.textAlign = 'center'; g.fillStyle = '#b9b6aa'; g.fillRect(c.x + 14, y + 27, c.w - 28, 2); });
    g.fillStyle = YEL; g.fillRect(c.x, c.y + 470, c.w, 46); text('MONTHLY: ASK ATTENDANT', c.cx, c.y + 494, 26, BLK, 800, c.w - 20);
    text('PLUS 18.375% PARKING TAX', c.cx, c.y + 536, 19, BLK, 600, c.w - 20); text('SUVS AND VANS $12 EXTRA  -  CAPACITY 46 CARS', c.cx, c.y + 560, 16, BLK, 600, c.w - 16); text('NOT RESPONSIBLE FOR ITEMS LEFT IN CAR', c.cx, c.y + 582, 15, '#444', 600, c.w - 16); }
  // a white arrow for the floor (nothing painted round it)
  { const c = cell('arrow'); g.fillStyle = WHITE; g.beginPath(); g.moveTo(c.cx, c.y + 8); g.lineTo(c.x + c.w - 8, c.y + 120); g.lineTo(c.cx + 22, c.y + 120); g.lineTo(c.cx + 22, c.y + c.h - 8); g.lineTo(c.cx - 22, c.y + c.h - 8); g.lineTo(c.cx - 22, c.y + 120); g.lineTo(c.x + 8, c.y + 120); g.closePath(); g.fill(); }
  { const c = cell('pay', BLUE); text('ATTENDANT', c.cx, c.y + 34, 44, WHITE, 800, c.w - 16); text('LEAVE KEY IN CAR', c.cx, c.y + 78, 24, YEL, 700, c.w - 16); }
  { const c = cell('mph', WHITE); g.strokeStyle = BLK; g.lineWidth = 6; g.strokeRect(c.x + 6, c.y + 6, c.w - 12, c.h - 12); text('SPEED', c.cx, c.y + 36, 30, BLK, 800); text('LIMIT', c.cx, c.y + 68, 30, BLK, 800); text('5', c.cx, c.y + 134, 100, BLK, 900); }
  // the band over the mouth
  { const c = cell('band', YEL); g.fillStyle = BLK; g.fillRect(c.x, c.y, c.w, 8); g.fillRect(c.x, c.y + c.h - 8, c.w, 8);
    g.fillRect(c.x + 14, c.y + 22, 190, c.h - 44); text('ENTER', c.x + 109, c.cy + 2, 56, YEL, 800, 170); g.fillRect(c.x + c.w - 204, c.y + 22, 190, c.h - 44); text('OPEN', c.x + c.w - 109, c.cy - 24, 44, YEL, 800, 170); text('24 HOURS', c.x + c.w - 109, c.cy + 26, 38, YEL, 800, 170);
    text('P A R K I N G', c.cx, c.cy + 4, 112, BLK, 900, 560); }
  { const c = cell('level1', BLUE); text('LEVEL', c.x + 92, c.cy, 50, WHITE, 800, 150); text('1', c.x + 204, c.cy + 4, 108, YEL, 900); }
  { const c = cell('level2', RED); text('LEVEL', c.x + 92, c.cy, 50, WHITE, 800, 150); text('2', c.x + 204, c.cy + 4, 108, WHITE, 900); }
  { const c = cell('exit', GREEN); text('EXIT TO STREET', c.cx, c.cy + 2, 46, WHITE, 800, c.w - 20); }
  { const c = cell('up', RED); text('UP TO LEVEL 2', c.cx, c.cy + 2, 38, WHITE, 800, c.w - 14); }
  { const c = cell('clear', YEL); text("CLEARANCE  6' - 8\"", c.cx, c.cy + 1, 26, BLK, 800, c.w - 20); }
  return cv;
}
