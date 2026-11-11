// storefronts.art.js: the three canvas atlases of the storefront layer, drawn at load (no image files, no brands: every name is made up).
//   mask  2048x2048  lettering as coverage: R main line, G second line, B ornament. Cells: 0..79 shop signs (512x80, 4 per row),
//                    200..215 window tag lines (512x40 from y 1600), 100..131 small squares (128x128 from y 1760).
//   rooms 2048x2048  16 back walls (1024x256: 2 per row), a wall four times as long as it is high.
//   props 2048x2048  40 cut-outs (256x384 = 1.3 m x 1.95 m; 8 per row, 5 rows = 5 families), premultiplied alpha.
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// name groups (5 names each, "main|second line"); the order is the group index used by storefronts.js
export const NAMES = [
  ['SUNNYSIDE DELI & GROCERY|OPEN 24 HOURS', 'CORNER GOURMET DELI|SANDWICHES · SALAD BAR · COFFEE', 'MADISON FARM MARKET|ORGANIC · FLOWERS · JUICE', 'ALL DAY DELI|HOT & COLD FOOD · ATM', 'ROSARIO FINE FOODS|EST. 1974'],
  ['PARKSIDE PHARMACY|PRESCRIPTIONS · VITAMINS', 'WELLSPRING DRUGS|SURGICAL SUPPLIES', 'NOMAD DRUGS|PHARMACY · SURGICAL', 'TWENTY-FIFTH ST. PHARMACY|', 'OSTROW PHARMACY|WE DELIVER'],
  ['FLATIRON WINE & SPIRITS|', 'CASK & CORK|WINES & LIQUORS', 'VENZANO LIQUORS|WINE · SPIRITS', 'THE BOTTLE ROOM|WINE · LIQUOR', 'OLD PIER WINE & LIQUOR|'],
  ['MARLOWE & PINE|', 'TINDAL|NEW YORK', 'atelier juniper|', 'NORTH LOFT CLOTHING CO.|', 'HALLORAN MEN’S SHOP|SUITS · SHIRTS · TAILORING'],
  ['SILVER SPOON DINER|BREAKFAST ALL DAY', 'THE LAMPLIGHT DINER|', 'TWO BRIDGES COFFEE SHOP|RESTAURANT', 'MIDTOWN GRILL|BURGERS · SHAKES', 'KOWALCZYK LUNCHEONETTE|'],
  ['FIVE BORO PIZZA|SLICES · HEROES · CALZONES', 'NONNA LETIZIA PIZZERIA|', 'HOT SLICE|PIZZA · PASTA', 'BRICK OVEN PIZZA|FREE DELIVERY', 'LUNA ROSSA PIZZA|'],
  ['THE COPPER KETTLE|BAR & GRILL', 'TILLERMAN TAVERN|', 'BAR MARISOL|', 'THE GRAY HERON BAR & GRILL|EST. 1931', 'LANTERN ROOM|COCKTAILS'],
  ['LUCKY ORCHID NAILS|MANICURE · PEDICURE · WAXING', 'PEARL NAIL SPA|', 'LILAC NAILS & SPA|WALK-INS WELCOME', 'ROSE GARDEN NAILS|', 'BRIGHT STAR NAIL SALON|'],
  ['BUBBLE LAND LAUNDROMAT|WASH · DRY · FOLD', 'SPOTLESS CLEANERS|TAILORING · SAME DAY', 'CRYSTAL DRY CLEANERS|', 'EAST SIDE WASH & FOLD|', 'FRENCH HAND LAUNDRY|ALTERATIONS'],
  ['KESTREL SAVINGS BANK|', 'FENNIMORE TRUST|', 'HARBORLIGHT BANK|', 'FIRST MERIDIAN CREDIT UNION|', 'GRAMERCY MUTUAL BANK|'],
  ['EMPIRE HARDWARE|PAINT · KEYS · PLUMBING', 'ACORN HARDWARE & SUPPLY|', 'BROADWAY LOCKSMITH|HARDWARE · SAFES', 'TWENTY-EIGHTH ST. TOOL CO.|', 'M. FELDSHUH & SONS|HOUSEWARES'],
  ['HEARTH & LOOM|HOME', 'FOUNDRY MODERN|FURNITURE · LIGHTING', 'GALLERY ORVIETO|', 'CEDAR STREET RUGS|', 'STUDIO LARKSPUR|'],
  ['GRINDHOUSE COFFEE|', 'café fennel|ESPRESSO · PASTRY', 'TWO SPARROWS BAKERY|BREAD · CAKES · COFFEE', 'BLACK KETTLE ROASTERS|', 'MORNING BELL BAGELS|'],
  ['PETAL & STEM|FLOWERS', 'CHELSEA BLOOMS|PLANTS · GIFTS', 'WILD FERN FLORIST|', 'THE FLOWER STALL|', 'IVY LANE FLOWERS|WEDDINGS · EVENTS'],
  ['ZALMAN JEWELERS|DIAMONDS · WATCHES · REPAIRS', 'CLEAR VIEW OPTICAL|EYE EXAMS', 'GOLDEN THIMBLE FABRICS|WHOLESALE · RETAIL', 'NOMAD PERFUME & COSMETICS|WHOLESALE', 'STAR ELECTRONICS & LUGGAGE|'],
  ['TONY & SAL BARBER SHOP|', 'GENTLEMEN’S CUT|BARBER SHOP', 'UPTOWN FADES|', 'THE CLIPPER ROOM|HOT SHAVES', 'CLASSIC BARBERS|WALK-INS'],
];
const TAGS = ['COLD CUTS · SALADS · COFFEE · JUICE · FLOWERS', 'PRESCRIPTIONS · PHOTO · VITAMINS · BEAUTY', 'WINE · LIQUOR · WE DELIVER · LOTTO', 'NEW SEASON · IN STORE NOW', 'BREAKFAST · LUNCH · DINNER · TAKE OUT',
  'SLICES · WHOLE PIES · CATERING · DELIVERY', 'HAPPY HOUR 4 – 7 · KITCHEN OPEN LATE', 'MANICURE · PEDICURE · GEL · WAXING', 'DROP OFF SERVICE · SAME DAY · PICK UP & DELIVERY', 'CHECKING · SAVINGS · MORTGAGES · 24 HOUR ATM',
  'KEYS CUT · PAINT MIXED · PLUMBING · ELECTRICAL', 'TO THE TRADE & PUBLIC · OPEN 7 DAYS', 'ESPRESSO · POUR OVER · FRESH PASTRY', 'FRESH CUT FLOWERS · PLANTS · DELIVERY', 'WHOLESALE & RETAIL · OPEN TO THE PUBLIC', 'HAIRCUTS · HOT TOWEL SHAVES · BEARD TRIMS'];
const BLADE = ['DELI', 'Rx', 'WINE', 'SALE', 'EAT', 'PIZZA', 'BAR', 'NAILS', 'WASH', 'BANK', 'KEYS', 'HOME', 'CAFE', 'FLOWERS', 'GOLD', 'BARBER'];
const NUMS = ['12', '41', '105', '230', '366', '1107', '928', '53'];
const FONTS = ['700 X "Helvetica Neue", Helvetica, Arial, sans-serif', '800 X "Arial Narrow", "Helvetica Neue", Arial, sans-serif', '700 X Georgia, "Times New Roman", serif', '400 X Impact, "Arial Narrow", sans-serif',
  '700 X Futura, "Trebuchet MS", sans-serif', '400 X Didot, "Bodoni 72", Georgia, serif', '700 X "Gill Sans", "Trebuchet MS", sans-serif', 'italic 700 X Georgia, serif', '700 X Rockwell, "Courier New", serif',
  '400 X "Brush Script MT", "Snell Roundhand", cursive', '700 X Copperplate, Georgia, serif', '700 X "American Typewriter", "Courier New", serif', '600 X Optima, "Gill Sans", sans-serif', '700 X "Avenir Next Condensed", "Arial Narrow", sans-serif'];

function fit(g, t, font, size, maxW, x, y, sp) {
  g.font = font.replace('X', size + 'px'); if (sp && 'letterSpacing' in g) g.letterSpacing = sp + 'px';
  const w = g.measureText(t).width; g.save(); g.translate(x, y); if (w > maxW) g.scale(maxW / w, 1); g.fillText(t, 0, 0); g.restore(); if ('letterSpacing' in g) g.letterSpacing = '0px';
  return Math.min(w, maxW);
}
function tex(THREE, c, srgb, pm) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.premultiplyAlpha = !!pm; return t;
}

export function makeMask(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'); const R = rng(77);
  g.fillStyle = '#000'; g.fillRect(0, 0, 2048, 2048); g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalCompositeOperation = 'lighter';
  NAMES.forEach((grp, gi) => grp.forEach((nm, ni) => {
    const i = gi * 5 + ni, x = (i % 4) * 512, y = Math.floor(i / 4) * 80, [a, b] = nm.split('|'); const f = FONTS[Math.floor(R() * FONTS.length)], script = f.includes('Brush');
    g.save(); g.beginPath(); g.rect(x + 4, y + 3, 504, 74); g.clip();
    g.fillStyle = '#f00'; const sp = R() < 0.4 && !script ? 3 : 0;
    const w = fit(g, script ? a.replace(/[A-Z]+/g, (s) => s[0] + s.slice(1).toLowerCase()) : a, f, b ? 46 : 56, 470, x + 256, y + (b ? 30 : 41), sp);
    if (b) { g.fillStyle = '#0f0'; fit(g, b, FONTS[R() < 0.5 ? 0 : 6], 15, 440, x + 256, y + 66, 2); }
    else if (R() < 0.5) { g.fillStyle = '#00f'; g.fillRect(x + 256 - w / 2, y + 73, w, 2); g.fillRect(x + 256 - w / 2, y + 6, w, 2); }
    g.restore();
  }));
  TAGS.forEach((t, i) => { g.fillStyle = '#f00'; fit(g, t, FONTS[i % 2 ? 0 : 6], 24, 490, (i % 4) * 512 + 256, 1600 + Math.floor(i / 4) * 40 + 21, 1); });
  const sm = (i, fn) => { const x = (i % 16) * 128, y = 1760 + Math.floor(i / 16) * 128; g.save(); g.translate(x, y); g.beginPath(); g.rect(3, 3, 122, 122); g.clip(); fn(); g.restore(); };
  BLADE.forEach((t, i) => sm(i, () => { g.fillStyle = '#f00'; fit(g, t, FONTS[[0, 2, 3, 4, 6][i % 5]], t.length > 5 ? 30 : 40, 104, 64, 66, 0); g.strokeStyle = '#00f'; g.lineWidth = 4; g.strokeRect(9, 9, 110, 110); }));
  [['HOURS', 'MON – FRI   7 – 10', 'SATURDAY   8 – 10', 'SUNDAY   8 – 8'], ['OPEN', 'MON – SAT', '10 AM – 7 PM', 'SUN 12 – 6'], ['OPEN 24 HRS', '7 DAYS', 'ATM · LOTTO', 'WE DELIVER']].forEach((ls, k) => sm(16 + k, () => {
    g.fillStyle = '#f00'; fit(g, ls[0], FONTS[0], 24, 110, 64, 20, 1); ls.slice(1).forEach((t, j) => fit(g, t, FONTS[6], 15, 112, 64, 52 + j * 24, 0)); g.fillRect(14, 36, 100, 2); }));
  sm(19, () => { g.fillStyle = '#f00'; fit(g, 'OPEN', FONTS[0], 46, 108, 64, 66, 2); });
  NUMS.forEach((t, k) => sm(20 + k, () => { g.fillStyle = '#f00'; fit(g, t, FONTS[[5, 2, 4, 10][k % 4]], 62, 112, 64, 68, 2); }));
  sm(28, () => { g.fillStyle = '#f00'; fit(g, 'ATM', FONTS[0], 50, 108, 64, 66, 2); });
  sm(29, () => { g.fillStyle = '#f00'; fit(g, 'SALE', FONTS[3], 54, 108, 64, 52, 2); fit(g, 'UP TO 50% OFF', FONTS[0], 14, 108, 64, 98, 0); });
  sm(30, () => { g.fillStyle = '#f00'; fit(g, 'LOADING', FONTS[1], 30, 110, 64, 34, 0); fit(g, 'ZONE', FONTS[1], 30, 110, 64, 66, 0); fit(g, 'NO PARKING', FONTS[0], 14, 110, 64, 100, 0); g.strokeStyle = '#00f'; g.lineWidth = 3; g.strokeRect(7, 7, 114, 114); });
  sm(31, () => { g.fillStyle = '#f00'; fit(g, 'FOR', FONTS[1], 30, 110, 64, 26, 0); fit(g, 'LEASE', FONTS[1], 36, 110, 64, 60, 0); fit(g, '212 555 0142', FONTS[0], 15, 110, 64, 100, 0); });
  return tex(THREE, c, false);
}

// ---------------------------------------------------------------------------------------------------------------- goods
const P = {
  grocery: ['#c8102e', '#f4c20d', '#1f6fb2', '#2e8b3d', '#f28c28', '#ffffff', '#7b3fa0', '#e8d9b5', '#d94f70', '#3bb3c3', '#8a5a2b', '#111111'],
  pharm: ['#ffffff', '#e9eef2', '#2a7fc1', '#58b368', '#f2f2f2', '#d6e6f2', '#e84a5f', '#f6d55c', '#ffffff', '#9fd3c7'],
  bottle: ['#1d3b1f', '#2a2a2a', '#5a2a12', '#3a1a22', '#c9a227', '#e8e2c8', '#274227', '#101820', '#7a1f1f', '#d8c59a'],
  cloth: ['#1b1b1f', '#2d3a55', '#e9e4d8', '#7a2e2e', '#c7b299', '#3d4a3a', '#8c8c8c', '#b55d3a', '#f2efe9', '#4a3b5c', '#d9c36a', '#283845'],
  paint: ['#d9d9d9', '#b23a2e', '#e0a526', '#2f5f8a', '#4d7a3c', '#f2f2f2', '#333333', '#c96f2b'],
  book: ['#7a2e2e', '#2d3a55', '#e9e4d8', '#3d4a3a', '#c9a227', '#1b1b1f', '#b55d3a', '#5a7d8c'],
};
const pick = (R, a) => a[Math.floor(R() * a.length)];
function products(g, R, x, y, w, h, pal, kind) {       // a shelf row: items standing on the line y + h
  let px = x + 1;
  while (px < x + w - 3) {
    let iw = 6 + R() * 12, ih = h * (0.55 + 0.4 * R());
    if (kind === 'bottle') { iw = 5 + R() * 3; ih = h * (0.75 + 0.2 * R()); } else if (kind === 'book') { iw = 3 + R() * 4; ih = h * (0.7 + 0.28 * R()); } else if (kind === 'fold') { iw = 20 + R() * 12; ih = h * (0.3 + 0.6 * R()); } else if (kind === 'can') { iw = 5 + R() * 4; ih = h * (0.35 + 0.25 * R()); }
    const col = pick(R, pal), n = kind === 'book' || kind === 'fold' ? 1 : 1 + Math.floor(R() * 4);
    for (let k = 0; k < n && px + iw < x + w - 1; k++) {
      g.fillStyle = col;
      if (kind === 'bottle') { g.fillRect(px, y + h - ih * 0.72, iw, ih * 0.72); g.fillRect(px + iw * 0.3, y + h - ih, iw * 0.4, ih * 0.3); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(px + 0.5, y + h - ih * 0.5, iw - 1, ih * 0.22); }
      else if (kind === 'fold') { for (let q = 0; q < ih; q += 4) { g.fillStyle = q % 8 ? col : pick(R, pal); g.fillRect(px, y + h - q - 4, iw, 3.4); } }
      else { g.fillRect(px, y + h - ih, iw, ih); if (kind !== 'book') { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.35)'; g.fillRect(px + 1, y + h - ih * (0.4 + 0.3 * R()), iw - 2, ih * 0.22); } }
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(px + iw - 1, y + h - ih, 1, ih);
      px += iw + (kind === 'book' ? 0 : 1);
    }
    px += R() < 0.12 ? 6 + R() * 10 : 0;
  }
}
function shelves(g, R, x, y, w, h, rows, pal, kind, bg, board) {
  g.fillStyle = bg; g.fillRect(x, y, w, h); const rh = h / rows;
  for (let r = 0; r < rows; r++) { products(g, R, x + 2, y + r * rh + 3, w - 4, rh - 6, pal, Array.isArray(kind) ? kind[r % kind.length] : kind); g.fillStyle = board; g.fillRect(x, y + (r + 1) * rh - 3, w, 3); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + r * rh, w, 3); }
}
function lines(g, R, x, y, w, h, col, n) { g.fillStyle = col; for (let i = 0; i < n; i++) g.fillRect(x, y + (i + 0.3) * h / n, w * (0.45 + 0.5 * R()), Math.max(1, h / n * 0.34)); }
function vshade(g, x, y, w, h, top, bot) { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, `rgba(0,0,0,${top})`); gr.addColorStop(1, `rgba(0,0,0,${bot})`); g.fillStyle = gr; g.fillRect(x, y, w, h); }

// ---------------------------------------------------------------------------------------------------------------- back walls
export function makeRooms(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'); const W = 1024, H = 256;
  const cell = (i, fn) => { g.save(); g.translate((i % 2) * W, Math.floor(i / 2) * H); g.beginPath(); g.rect(0, 0, W, H); g.clip(); fn(rng(900 + i * 13)); vshade(g, 0, 0, W, H, 0.0, 0.16); g.restore(); };
  const menu = (R, x, w, dark) => { g.fillStyle = dark ? '#16181a' : '#f3efe2'; g.fillRect(x, 14, w, 62); g.fillStyle = pick(R, ['#c8102e', '#f4c20d', '#2e8b3d', '#f28c28']); g.fillRect(x, 14, w, 11); for (let k = 0; k < 3; k++) lines(g, R, x + 5 + k * w / 3, 29, w / 3 - 10, 44, dark ? '#d8d4c8' : '#333', 6); };
  cell(0, (R) => { g.fillStyle = '#cfc8b8'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 128) { const cool = R() < 0.3; if (cool) { g.fillStyle = '#20262a'; g.fillRect(x + 2, 40, 124, 214); g.fillStyle = '#dfe9ee'; g.fillRect(x + 8, 46, 112, 200); shelves(g, R, x + 8, 46, 112, 200, 5, P.grocery, ['bottle', 'can'], '#dfe9ee', '#b9c4c9'); g.fillStyle = '#20262a'; g.fillRect(x + 62, 40, 4, 214); } else shelves(g, R, x + 2, 34, 124, 220, 6, P.grocery, ['box', 'can', 'box', 'bottle'], '#b9b2a2', '#efe9dc'); } g.fillStyle = '#b21f24'; g.fillRect(0, 22, W, 12); });
  cell(1, (R) => { g.fillStyle = '#eef1f2'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 160) shelves(g, R, x + 3, 44, 154, 210, 6, P.pharm, ['box', 'bottle', 'box'], '#dfe5e8', '#ffffff'); g.fillStyle = '#2a7fc1'; g.fillRect(0, 24, W, 16); g.fillStyle = '#fff'; for (let x = 40; x < W; x += 256) lines(g, R, x, 27, 120, 10, '#fff', 1); g.fillStyle = '#2e9b57'; for (let x = 200; x < W; x += 512) { g.fillRect(x, 4, 6, 18); g.fillRect(x - 6, 10, 18, 6); } });
  cell(2, (R) => { g.fillStyle = '#2a1a10'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 146) shelves(g, R, x + 3, 22, 140, 232, 7, P.bottle, 'bottle', '#3b2616', '#6b4526'); for (let x = 0; x < W; x += 146) { g.fillStyle = 'rgba(255,214,150,.10)'; g.fillRect(x + 3, 22, 140, 232); } });
  cell(3, (R) => { g.fillStyle = '#e6e1d6'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 256) { g.fillStyle = '#d6d0c2'; g.fillRect(x + 6, 20, 244, 234); g.fillStyle = '#8f8f8f'; g.fillRect(x + 14, 58, 228, 3);
    for (let px = x + 18; px < x + 236; px += 9 + R() * 5) { const l = 60 + R() * 55, wd = 9 + R() * 5; g.fillStyle = pick(R, P.cloth); g.beginPath(); g.moveTo(px + wd / 2, 61); g.lineTo(px + wd, 70); g.lineTo(px + wd, 61 + l); g.lineTo(px, 61 + l); g.lineTo(px, 70); g.closePath(); g.fill(); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(px + wd - 1.5, 70, 1.5, l - 9); }
    shelves(g, R, x + 14, 186, 228, 66, 2, P.cloth, 'fold', '#cfc8b8', '#f4f0e6'); shelves(g, R, x + 14, 24, 228, 28, 1, P.cloth, 'fold', '#d6d0c2', '#f4f0e6'); } });
  cell(4, (R) => { g.fillStyle = '#e9e6dc'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(0,0,0,.10)'; g.lineWidth = 1; for (let y = 80; y < 170; y += 9) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } for (let x = 0; x < W; x += 18) { g.beginPath(); g.moveTo(x, 80); g.lineTo(x, 170); g.stroke(); }
    for (let x = 10; x < W; x += 170) menu(R, x, 150, R() < 0.5); g.fillStyle = '#9aa0a3'; g.fillRect(0, 168, W, 88); g.fillStyle = '#c9ced0'; g.fillRect(0, 168, W, 6);
    for (let x = 20; x < W; x += 60 + R() * 90) { const w = 40 + R() * 50, h = 30 + R() * 50; g.fillStyle = pick(R, ['#70777b', '#b7bdc0', '#3a3e40', '#d7dbdc']); g.fillRect(x, 168 - h, w, h); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + 4, 168 - h + 5, w - 8, h * 0.45); }
    shelves(g, R, 0, 94, W, 30, 1, ['#fff', '#e8d9b5', '#c8102e', '#f4c20d', '#d8d4c8'], 'can', 'rgba(0,0,0,0)', '#8d9396'); });
  cell(5, (R) => { g.fillStyle = '#f1ede2'; g.fillRect(0, 0, W, H); for (let y = 84; y < 256; y += 14) for (let x = (y / 14 % 2) * 14; x < W; x += 28) { g.fillStyle = 'rgba(178,31,36,.82)'; g.fillRect(x, y, 14, 14); }
    g.fillStyle = '#f1ede2'; g.fillRect(0, 84, W, 60); for (let x = 12; x < W; x += 200) menu(R, x, 176, false); g.fillStyle = '#7b7f82'; g.fillRect(0, 150, W, 106); g.fillStyle = '#c3c7c9'; g.fillRect(0, 150, W, 7);
    for (let x = 30; x < W; x += 256) { g.fillStyle = '#2b2d2e'; g.fillRect(x, 96, 150, 54); g.fillStyle = '#e8762a'; g.fillRect(x + 10, 112, 130, 30); g.fillStyle = 'rgba(255,220,120,.7)'; g.fillRect(x + 20, 120, 110, 12); } });
  cell(6, (R) => { g.fillStyle = '#1d120c'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 256) { g.fillStyle = '#3a2416'; g.fillRect(x + 4, 16, 248, 240); const gr = g.createLinearGradient(x, 30, x + 248, 150); gr.addColorStop(0, '#4c5a5e'); gr.addColorStop(1, '#8c9a9c'); g.fillStyle = gr; g.fillRect(x + 22, 30, 212, 60);
    shelves(g, R, x + 22, 92, 212, 84, 3, P.bottle.concat(['#d7e6ea', '#b9d1d6', '#e7c66b']), 'bottle', '#2a1a10', '#c9a25a'); g.fillStyle = 'rgba(255,190,110,.16)'; g.fillRect(x + 22, 92, 212, 84); g.fillStyle = '#24160d'; g.fillRect(x, 190, 256, 66); g.fillStyle = '#8a5a2b'; g.fillRect(x, 186, 256, 6); }
    g.fillStyle = '#0c1a2e'; g.fillRect(600, 34, 96, 52); g.fillStyle = '#4f86c6'; g.fillRect(604, 38, 88, 44); g.fillStyle = '#7fd08a'; g.fillRect(604, 62, 88, 20); });
  cell(7, (R) => { g.fillStyle = pick(R, ['#efdfe3', '#e6e9df']); g.fillRect(0, 0, W, H); for (let x = 20; x < W; x += 128) { g.fillStyle = '#b89b6a'; g.fillRect(x - 3, 47, 76, 116); const gr = g.createLinearGradient(x, 50, x + 70, 160); gr.addColorStop(0, '#dfe7ea'); gr.addColorStop(1, '#aebbc0'); g.fillStyle = gr; g.fillRect(x, 50, 70, 110); g.fillStyle = '#d8d0c4'; g.fillRect(x - 10, 180, 100, 76); g.fillStyle = '#f7f4ee'; g.fillRect(x - 12, 176, 104, 6); }
    for (let x = 0; x < W; x += 340) { g.fillStyle = '#fff'; g.fillRect(x + 100, 30, 26, 150); for (let y = 34; y < 176; y += 9) for (let q = 0; q < 3; q++) { g.fillStyle = pick(R, ['#e84a5f', '#ff8fab', '#b5179e', '#f6d55c', '#c1121f', '#ffd6e0', '#7b2cbf', '#f4a261']); g.fillRect(x + 102 + q * 8, y, 6, 7); } } });
  cell(8, (R) => { g.fillStyle = '#dfe3e2'; g.fillRect(0, 0, W, H); for (let x = 6; x < W; x += 92) for (let r = 0; r < 2; r++) { const y = 36 + r * 108; g.fillStyle = '#f4f5f3'; g.fillRect(x, y, 86, 104); g.strokeStyle = '#9aa0a3'; g.lineWidth = 2; g.strokeRect(x, y, 86, 104); g.fillStyle = '#aab1b4'; g.beginPath(); g.arc(x + 43, y + 58, 33, 0, 7); g.fill(); g.fillStyle = '#1d2a33'; g.beginPath(); g.arc(x + 43, y + 58, 26, 0, 7); g.fill(); if (R() < 0.5) { g.fillStyle = pick(R, P.cloth); g.beginPath(); g.arc(x + 43, y + 66, 18, 0, 3.14); g.fill(); } g.fillStyle = '#39424a'; g.fillRect(x + 8, y + 6, 40, 10); }
    g.fillStyle = '#2a7fc1'; g.fillRect(0, 14, W, 14); });
  cell(9, (R) => { g.fillStyle = '#5a3d27'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 64) { g.fillStyle = R() < 0.5 ? '#63442c' : '#553923'; g.fillRect(x + 2, 8, 60, 150); g.strokeStyle = 'rgba(0,0,0,.3)'; g.strokeRect(x + 6, 12, 52, 142); }
    g.fillStyle = '#d9d2c2'; g.fillRect(0, 160, W, 96); g.fillStyle = '#3b2616'; g.fillRect(0, 156, W, 8); for (let x = 30; x < W; x += 128) { g.fillStyle = 'rgba(190,215,225,.5)'; g.fillRect(x, 84, 90, 72); g.strokeStyle = '#b89b4a'; g.lineWidth = 3; g.strokeRect(x, 84, 90, 72); }
    g.fillStyle = '#1f4e5f'; g.fillRect(440, 20, 150, 46); g.fillStyle = '#e9c46a'; g.fillRect(452, 30, 60, 6); g.fillRect(452, 44, 110, 6); g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(860, 44, 22, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(860, 44); g.lineTo(860, 28); g.moveTo(860, 44); g.lineTo(872, 48); g.stroke(); });
  cell(10, (R) => { g.fillStyle = '#cdbfa8'; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 128) { g.fillStyle = R() < 0.5 ? '#d4c7b1' : '#c5b69d'; g.fillRect(x + 1, 0, 126, H); g.strokeStyle = 'rgba(90,70,50,.25)'; g.lineWidth = 1; for (let k = 0; k < 5; k++) { g.beginPath(); let yy = R() * H; g.moveTo(x, yy); for (let q = 0; q < 128; q += 16) { yy += (R() - 0.5) * 40; g.lineTo(x + q, yy); } g.stroke(); } }
    for (let x = 90; x < W; x += 340) { g.fillStyle = '#6d6a63'; g.fillRect(x - 6, 62, 152, 194); for (let d = 0; d < 2; d++) { const gr = g.createLinearGradient(x + d * 70, 0, x + d * 70 + 68, 0); gr.addColorStop(0, '#9a9890'); gr.addColorStop(0.5, '#c9c7bd'); gr.addColorStop(1, '#8b897f'); g.fillStyle = gr; g.fillRect(x + d * 70, 68, 68, 188); } g.fillStyle = '#ffd98a'; g.fillRect(x + 60, 46, 20, 8); }
    for (let x = 270; x < W; x += 340) { g.fillStyle = '#2a2a28'; g.fillRect(x, 60, 110, 86); g.fillStyle = pick(R, ['#a4472f', '#27506b', '#c29b3a']); g.fillRect(x + 8, 68, 94, 70); g.fillStyle = pick(R, ['#e9e4d8', '#1b1b1f']); g.fillRect(x + 30, 80, 50, 30); g.fillStyle = 'rgba(255,225,160,.5)'; g.beginPath(); g.arc(x - 30, 70, 14, 0, 7); g.fill(); } });
  cell(11, (R) => { g.fillStyle = '#b9a47c'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,.14)'; for (let y = 6; y < 130; y += 8) for (let x = 4; x < W; x += 8) g.fillRect(x, y, 1.5, 1.5);
    for (let x = 10; x < W; x += 14 + R() * 22) { const y = 14 + R() * 80, h = 22 + R() * 40; g.fillStyle = pick(R, ['#2b2b2b', '#b23a2e', '#e0a526', '#7d8488', '#2f5f8a']); g.fillRect(x, y, 3 + R() * 5, h); g.fillRect(x - 3, y, 9 + R() * 6, 6); }
    shelves(g, R, 0, 134, W, 122, 3, P.paint, ['can', 'box', 'can'], '#8d7b5a', '#d9cfb8'); });
  cell(12, (R) => { g.fillStyle = '#ebe8e1'; g.fillRect(0, 0, W, H); for (let x = 50; x < W; x += 150 + R() * 90) { const w = 60 + R() * 80, h = 50 + R() * 70, y = 50 + R() * 40; g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 3, y + 4, w, h); g.fillStyle = pick(R, ['#1b1b1f', '#e9e4d8', '#8c6a3a']); g.fillRect(x, y, w, h); g.fillStyle = pick(R, ['#a4472f', '#27506b', '#c29b3a', '#44624a', '#d8d4c8', '#5c4a72']); g.fillRect(x + 5, y + 5, w - 10, h - 10); g.fillStyle = pick(R, ['#e9e4d8', '#1b1b1f', '#d98f4e', '#9fb7c4']); g.beginPath(); g.arc(x + w * (0.3 + 0.4 * R()), y + h * 0.5, Math.min(w, h) * 0.22, 0, 7); g.fill(); const gr = g.createRadialGradient(x + w / 2, y - 10, 5, x + w / 2, y + h / 2, w); gr.addColorStop(0, 'rgba(255,240,210,.35)'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(x - 40, y - 40, w + 80, h + 80); }
    g.fillStyle = '#d6d2c9'; g.fillRect(0, 236, W, 20); });
  cell(13, (R) => { g.fillStyle = '#7a4a36'; g.fillRect(0, 0, W, H); for (let y = 0; y < H; y += 9) for (let x = (y / 9 % 2) * 13 - 13; x < W; x += 26) { g.fillStyle = pick(R, ['#8b5540', '#74442f', '#96604a', '#6a3d2b']); g.fillRect(x, y, 25, 8); }
    for (let x = 30; x < W; x += 330) { g.fillStyle = '#1c1f1e'; g.fillRect(x, 20, 180, 80); g.strokeStyle = '#8a5a2b'; g.lineWidth = 4; g.strokeRect(x, 20, 180, 80); for (let k = 0; k < 3; k++) lines(g, R, x + 10 + k * 56, 30, 46, 62, 'rgba(240,236,220,.85)', 7); shelves(g, R, x + 200, 30, 110, 72, 2, ['#e8d9b5', '#8a5a2b', '#fff', '#2b2b2b', '#c8102e'], ['can', 'box'], 'rgba(0,0,0,.25)', '#c9a25a'); }
    g.fillStyle = '#2b2622'; g.fillRect(0, 170, W, 86); g.fillStyle = '#b98a55'; g.fillRect(0, 164, W, 8); for (let x = 60; x < W; x += 256) { g.fillStyle = '#c3c7c9'; g.fillRect(x, 124, 80, 40); g.fillStyle = '#2b2d2e'; g.fillRect(x + 8, 136, 64, 20); g.fillStyle = '#e9e4d8'; for (let k = 0; k < 6; k++) g.fillRect(x + 100 + k * 12, 150, 9, 14); } });
  cell(14, (R) => { g.fillStyle = '#dfe3d6'; g.fillRect(0, 0, W, H); for (let r = 0; r < 3; r++) { const y = 70 + r * 62; g.fillStyle = '#8a6a45'; g.fillRect(0, y, W, 5); for (let x = 8; x < W; x += 26 + R() * 22) { const s = 12 + R() * 12; g.fillStyle = pick(R, ['#3a3a3a', '#b5651d', '#e9e4d8', '#4f6d7a']); g.fillRect(x - s * 0.4, y - s * 0.8, s * 0.8, s * 0.8); for (let k = 0; k < 26; k++) { g.fillStyle = k % 3 ? pick(R, ['#2f6b34', '#3f8a42', '#1f4d27', '#5aa055']) : pick(R, ['#e84a5f', '#f6d55c', '#ffffff', '#b5179e', '#f28c28', '#ff8fab']); g.beginPath(); g.arc(x + (R() - 0.5) * s * 1.6, y - s * 0.8 - R() * s * 1.5, 2 + R() * 3.5, 0, 7); g.fill(); } } } });
  cell(15, (R) => { g.fillStyle = '#2a2622'; g.fillRect(0, 0, W, H); for (let x = 10; x < W; x += 170) { g.fillStyle = '#f3ead6'; g.fillRect(x, 40, 150, 130); g.strokeStyle = '#b89b4a'; g.lineWidth = 3; g.strokeRect(x, 40, 150, 130); for (let r = 0; r < 4; r++) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x, 40 + (r + 1) * 32 - 3, 150, 3); for (let px = x + 8; px < x + 140; px += 9 + R() * 8) { g.fillStyle = pick(R, ['#1b1b1f', '#b89b4a', '#7d8488', '#27506b', '#7a2e2e', '#d8d4c8']); g.fillRect(px, 40 + (r + 1) * 32 - 5 - (5 + R() * 14), 4 + R() * 6, 5 + R() * 14); } } g.fillStyle = '#3b332b'; g.fillRect(x, 180, 150, 76); g.fillStyle = 'rgba(210,230,238,.55)'; g.fillRect(x + 4, 184, 142, 30); } });
  return tex(THREE, c, true);
}

// ---------------------------------------------------------------------------------------------------------------- cut-outs
export function makeProps(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 2048; const g = c.getContext('2d'); const CW = 256, CH = 384, M = 197;      // pixels per metre
  const Y = (m) => CH - m * M;
  const cell = (row, col, fn) => { g.save(); g.translate(col * CW, row * CH); g.beginPath(); g.rect(6, 2, CW - 12, CH - 2); g.clip(); fn(rng(row * 100 + col * 7 + 5)); g.restore(); };
  const shade = () => { g.globalCompositeOperation = 'source-atop'; const gr = g.createLinearGradient(0, 0, CW, 0); gr.addColorStop(0, 'rgba(255,255,255,.10)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.30)'); g.fillStyle = gr; g.fillRect(0, 0, CW, CH); g.globalCompositeOperation = 'source-over'; };
  const ell = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
  const poly = (col, pts) => { g.fillStyle = col; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); };
  const rr = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  function mannequin(R, cx, dress) {
    const skin = pick(R, ['#d9d4cc', '#e8e3da', '#2a2a2c', '#c9b8a3']), top = pick(R, P.cloth), bot = pick(R, P.cloth);
    ell(cx, Y(0.02), 36, 6, '#b9b9b6'); g.fillStyle = '#9a9a98'; g.fillRect(cx - 2, Y(0.9), 4, 0.9 * M);
    if (!dress) { poly(bot, [[cx - 30, Y(1.0)], [cx + 30, Y(1.0)], [cx + 26, Y(0.08)], [cx + 6, Y(0.08)], [cx, Y(0.8)], [cx - 6, Y(0.08)], [cx - 26, Y(0.08)]]); }
    else { g.fillStyle = skin; g.fillRect(cx - 17, Y(0.6), 11, 0.55 * M); g.fillRect(cx + 6, Y(0.6), 11, 0.55 * M); poly(top, [[cx - 26, Y(1.05)], [cx + 26, Y(1.05)], [cx + 44, Y(0.5)], [cx - 44, Y(0.5)]]); }
    g.fillStyle = skin; g.fillRect(cx - 52, Y(1.42), 13, 0.62 * M); g.fillRect(cx + 39, Y(1.42), 13, 0.62 * M);
    poly(top, [[cx - 40, Y(1.47)], [cx - 12, Y(1.53)], [cx + 12, Y(1.53)], [cx + 40, Y(1.47)], [cx + 34, Y(1.2)], [cx + 29, Y(0.97)], [cx - 29, Y(0.97)], [cx - 34, Y(1.2)]]);
    if (R() < 0.6) { poly(top, [[cx - 54, Y(1.45)], [cx - 38, Y(1.47)], [cx - 37, Y(1.0)], [cx - 54, Y(1.0)]]); poly(top, [[cx + 54, Y(1.45)], [cx + 38, Y(1.47)], [cx + 37, Y(1.0)], [cx + 54, Y(1.0)]]); if (R() < 0.6) { g.fillStyle = 'rgba(255,255,255,.75)'; poly('rgba(240,238,232,.9)', [[cx - 9, Y(1.53)], [cx + 9, Y(1.53)], [cx, Y(1.22)]]); } }
    g.fillStyle = skin; g.fillRect(cx - 7, Y(1.6), 14, 0.09 * M); ell(cx, Y(1.7), 17, 22, skin);
  }
  function rail(R) {
    g.fillStyle = '#b8bcc0'; g.fillRect(22, Y(1.55), 4, 1.55 * M); g.fillRect(230, Y(1.55), 4, 1.55 * M); g.fillRect(20, Y(1.57), 216, 5); g.fillRect(12, Y(0.03), 24, 5); g.fillRect(220, Y(0.03), 24, 5);
    for (let x = 32; x < 222; x += 11 + R() * 6) { const w = 12 + R() * 8, l = (0.55 + R() * 0.65) * M; poly(pick(R, P.cloth), [[x + w / 2, Y(1.54)], [x + w, Y(1.47)], [x + w, Y(1.47) + l], [x, Y(1.47) + l], [x, Y(1.47)]]); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + w - 2, Y(1.47), 2, l); }
  }
  function table(R, h, stacks) {
    g.fillStyle = '#5b4028'; g.fillRect(20, Y(h) + 8, 8, h * M); g.fillRect(228, Y(h) + 8, 8, h * M); rr(12, Y(h), 232, 12, 2, '#8a6642');
    if (stacks) for (let x = 22; x < 210; x += 44 + R() * 10) { const n = 2 + Math.floor(R() * 6); for (let k = 0; k < n; k++) rr(x, Y(h) - 9 - k * 9, 38, 8, 2, pick(R, P.cloth)); }
  }
  function gondola(R, pal, kinds) { g.fillStyle = '#d7d9d6'; g.fillRect(14, Y(1.5), 228, 1.5 * M); shelves(g, R, 18, Y(1.5) + 4, 220, 1.5 * M - 22, 5, pal, kinds, '#c3c6c2', '#f1f2ef'); g.fillStyle = '#8f9390'; g.fillRect(14, Y(0.09), 228, 0.09 * M); }
  function cooler(R) { rr(26, Y(1.92), 204, 1.92 * M, 4, '#1f2427'); g.fillStyle = '#e4eef2'; g.fillRect(36, Y(1.82), 184, 1.6 * M); shelves(g, R, 36, Y(1.82), 184, 1.6 * M, 5, P.grocery, ['bottle', 'can', 'bottle'], '#e4eef2', '#aebbc0'); g.fillStyle = '#1f2427'; g.fillRect(125, Y(1.82), 6, 1.6 * M); g.fillStyle = '#c9ced0'; g.fillRect(116, Y(1.2), 4, 60); g.fillRect(136, Y(1.2), 4, 60); g.fillStyle = 'rgba(255,255,255,.14)'; poly('rgba(255,255,255,.14)', [[40, Y(1.8)], [90, Y(1.8)], [50, Y(0.3)], [40, Y(0.3)]]); }
  function person(R, cx, hgt, seated) {
    const top = pick(R, P.cloth), bot = pick(R, ['#1b1b1f', '#283845', '#3b3b3b', '#5a4a3a']), skin = pick(R, ['#8d5b3f', '#c69472', '#e0b596', '#5d3a28', '#d9a57c']);
    g.filter = 'blur(1.2px)'; const s = hgt / 1.72;
    if (!seated) { rr(cx - 22 * s, Y(0.88 * s), 20 * s, 0.86 * s * M, 6, bot); rr(cx + 2 * s, Y(0.88 * s), 20 * s, 0.86 * s * M, 6, bot); }
    rr(cx - 30 * s, Y(1.47 * s), 60 * s, 0.66 * s * M, 14 * s, top); rr(cx - 40 * s, Y(1.44 * s), 14 * s, 0.6 * s * M, 6, top); rr(cx + 26 * s, Y(1.44 * s), 14 * s, 0.6 * s * M, 6, top);
    g.fillStyle = skin; g.fillRect(cx - 6 * s, Y(1.55 * s), 12 * s, 0.1 * s * M); ell(cx, Y(1.64 * s), 15 * s, 19 * s, skin); ell(cx, Y(1.70 * s), 16 * s, 13 * s, pick(R, ['#1a1410', '#3b2a1a', '#6b5a48', '#a8a39a', '#0e0e0e']));
    g.filter = 'none';
  }
  function plant(R, cx, h) { poly(pick(R, ['#b5651d', '#e9e4d8', '#3a3a3a']), [[cx - 26, Y(0.5)], [cx + 26, Y(0.5)], [cx + 19, Y(0)], [cx - 19, Y(0)]]); for (let k = 0; k < 46; k++) { const a = (R() - 0.5) * 2.2, l = (0.3 + R() * (h - 0.6)) * M; g.strokeStyle = pick(R, ['#2f6b34', '#3f8a42', '#1f4d27', '#4d9a50']); g.lineWidth = 5 + R() * 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx, Y(0.5)); g.quadraticCurveTo(cx + Math.sin(a) * l * 0.4, Y(0.5) - l * 0.8, cx + Math.sin(a) * l, Y(0.5) - Math.cos(a) * l); g.stroke(); } }
  function stool(cx, col) { g.fillStyle = '#b8bcc0'; g.fillRect(cx - 3, Y(0.72), 6, 0.72 * M); ell(cx, Y(0.02), 22, 5, '#9a9ea2'); g.strokeStyle = '#b8bcc0'; g.lineWidth = 3; g.beginPath(); g.ellipse(cx, Y(0.25), 17, 4, 0, 0, 7); g.stroke(); rr(cx - 24, Y(0.8), 48, 16, 7, col); }
  function counter(R, h, col, topc) { g.fillStyle = col; g.fillRect(6, Y(h), 244, h * M); for (let x = 6; x < 250; x += 61) { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(x + 6, Y(h) + 22, 49, h * M - 40); } g.fillStyle = topc; g.fillRect(2, Y(h) - 4, 252, 12); }
  function pendants(R, n, col) { for (let k = 0; k < n; k++) { const x = CW * (k + 0.5) / n, l = 150 + R() * 40; g.fillStyle = '#1b1b1b'; g.fillRect(x - 1, 0, 2, l); poly(col, [[x - 9, l], [x + 9, l], [x + 30, l + 34], [x - 30, l + 34]]); const gr = g.createRadialGradient(x, l + 38, 2, x, l + 38, 46); gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.3, 'rgba(255,214,140,.55)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.fillRect(x - 50, l + 4, 100, 90); ell(x, l + 36, 22, 6, '#fff3d0'); } }
  function neon(R, txt, c1, c2) { rr(34, Y(1.72), 188, 96, 10, 'rgba(8,8,10,.92)'); g.shadowBlur = 14; g.shadowColor = c2; g.strokeStyle = c2; g.lineWidth = 5; g.beginPath(); g.roundRect(46, Y(1.72) + 11, 164, 74, 22); g.stroke(); g.shadowColor = c1; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 46px "Helvetica Neue", Arial, sans-serif'; g.strokeStyle = c1; g.lineWidth = 5; g.strokeText(txt, 128, Y(1.72) + 50); g.shadowBlur = 0; g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.strokeText(txt, 128, Y(1.72) + 50); g.fillStyle = '#555'; g.fillRect(70, Y(1.95), 2, 46); g.fillRect(184, Y(1.95), 2, 46); }
  function boxes(R) { let y = Y(0); for (let k = 0; k < 4; k++) { const w = 90 + R() * 110, h = 50 + R() * 50, x = 20 + R() * (216 - w); y -= h; g.fillStyle = pick(R, ['#b08a5a', '#a37c4c', '#c09a68']); g.fillRect(x, y, w, h); g.fillStyle = 'rgba(232,220,190,.8)'; g.fillRect(x + w / 2 - 5, y, 10, h); g.strokeStyle = 'rgba(0,0,0,.3)'; g.strokeRect(x, y, w, h); if (y < Y(1.2)) break; } }
  function washer(y0) { rr(40, y0, 176, 168, 5, '#eef0ee'); g.strokeStyle = '#9aa0a3'; g.lineWidth = 2; g.strokeRect(40, y0, 176, 168); ell(128, y0 + 96, 56, 56, '#aab1b4'); ell(128, y0 + 96, 44, 44, '#1d2a33'); g.fillStyle = '#39424a'; g.fillRect(52, y0 + 8, 80, 18); }
  function chair(cx, col, flip) { const s = flip ? -1 : 1; g.fillStyle = col; g.fillRect(cx - 22, Y(0.47), 44, 8); g.fillRect(cx - 22 * s - (flip ? -5 : 0) - 0, Y(0.92), 5, 0.92 * M); g.fillRect(cx + 17 * s, Y(0.45), 5, 0.45 * M); g.fillRect(cx - 22 * s - (flip ? -5 : 0), Y(0.92), 5, 0.3 * M); rr(cx - 24 * s - (flip ? -7 : 0), Y(0.92), 7, 0.36 * M, 2, col); }
  // family 0: fashion
  cell(0, 0, (R) => { mannequin(R, 128, false); shade(); }); cell(0, 1, (R) => { mannequin(R, 128, true); shade(); }); cell(0, 2, (R) => { mannequin(R, 84, false); mannequin(R, 180, true); shade(); });
  cell(0, 3, (R) => { rail(R); shade(); }); cell(0, 4, (R) => { rail(R); shade(); }); cell(0, 5, (R) => { table(R, 0.8, true); shade(); });
  cell(0, 6, (R) => { g.fillStyle = '#e9e4d8'; g.fillRect(24, Y(1.7), 208, 1.7 * M); for (let r = 0; r < 4; r++) { g.fillStyle = '#bdb6a6'; g.fillRect(24, Y(1.7) + (r + 1) * 80 - 5, 208, 5); for (let x = 40; x < 200; x += 62) { const col = pick(R, ['#7a2e2e', '#1b1b1f', '#c7b299', '#2d3a55', '#b55d3a']); rr(x, Y(1.7) + (r + 1) * 80 - 44, 44, 38, 6, col); g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x + 22, Y(1.7) + (r + 1) * 80 - 44, 13, 3.14, 0); g.stroke(); } } shade(); });
  cell(0, 7, (R) => { g.fillStyle = '#2b2b2b'; g.fillRect(124, Y(0.7), 8, 0.7 * M); ell(128, Y(0.02), 40, 6, '#2b2b2b'); rr(50, Y(1.72), 156, 200, 3, '#b21f24'); g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '400 58px Impact, "Arial Narrow", sans-serif'; g.fillText('SALE', 128, Y(1.72) + 78); g.font = '700 24px "Helvetica Neue", Arial, sans-serif'; g.fillText('UP TO 50% OFF', 128, Y(1.72) + 130); g.fillRect(70, Y(1.72) + 150, 116, 4); });
  // family 1: eating and drinking
  cell(1, 0, (R) => { counter(R, 1.06, '#3b2a1e', '#b98a55'); stool(64, '#a12626'); stool(190, '#a12626'); shade(); });
  cell(1, 1, (R) => { chair(62, '#2b2622', false); chair(194, '#2b2622', true); g.fillStyle = '#2b2622'; g.fillRect(125, Y(0.74), 6, 0.74 * M); ell(128, Y(0.02), 26, 5, '#2b2622'); rr(78, Y(0.78), 100, 9, 3, '#d9cfb8'); rr(110, Y(0.9), 12, 22, 2, '#f1f1ee'); rr(134, Y(0.86), 16, 14, 2, '#c8102e'); shade(); });
  cell(1, 2, (R) => { rr(14, Y(1.3), 228, 1.3 * M, 4, '#2b2622'); g.fillStyle = 'rgba(235,242,240,.92)'; g.fillRect(22, Y(1.24), 212, 0.62 * M); for (let r = 0; r < 3; r++) { g.fillStyle = '#b9c4c0'; g.fillRect(22, Y(1.24) + (r + 1) * 40 - 4, 212, 3); for (let x = 30; x < 222; x += 20 + R() * 8) ell(x + 8, Y(1.24) + (r + 1) * 40 - 12, 8 + R() * 3, 7, pick(R, ['#c98f4e', '#e9c98a', '#8a4b2b', '#f1e3c4', '#d9627a', '#f6d55c'])); } shade(); });
  cell(1, 3, (R) => { counter(R, 1.1, '#24160d', '#8a5a2b'); person(R, 128, 1.74, true); g.globalCompositeOperation = 'destination-over'; g.globalCompositeOperation = 'source-over'; counter(R, 1.1, '#24160d', '#8a5a2b'); for (let x = 30; x < 230; x += 28) rr(x, Y(1.1) - 30, 9, 28, 2, pick(R, P.bottle)); shade(); });
  cell(1, 4, (R) => { pendants(R, 2, pick(R, ['#1b1b1b', '#b98a3a', '#7a2e2e'])); });
  cell(1, 5, (R) => { person(R, 128, 1.3, true); chair(128, '#2b2622', false); rr(170, Y(0.78), 80, 9, 3, '#d9cfb8'); g.fillStyle = '#2b2622'; g.fillRect(207, Y(0.74), 6, 0.74 * M); shade(); });
  cell(1, 6, (R) => { chair(70, '#5b4028', false); chair(196, '#5b4028', true); g.fillStyle = '#5b4028'; g.fillRect(125, Y(0.74), 6, 0.74 * M); rr(84, Y(0.78), 88, 9, 3, '#8a6642'); plant(R, 128, 0.2); shade(); });
  cell(1, 7, (R) => neon(R, 'OPEN', '#ff3b30', '#2f7bff'));
  // family 2: groceries, drugs, hardware
  cell(2, 0, (R) => { gondola(R, P.grocery, ['box', 'can', 'bottle']); shade(); }); cell(2, 1, (R) => { gondola(R, P.pharm.concat(P.grocery), ['box', 'bottle']); shade(); }); cell(2, 2, (R) => cooler(R));
  cell(2, 3, (R) => { boxes(R); shade(); });
  cell(2, 4, (R) => { g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.strokeRect(50, Y(1.6), 156, 1.58 * M); for (let r = 0; r < 6; r++) for (let x = 56; x < 196; x += 24) { rr(x, Y(1.56) + r * 50, 21, 42, 3, pick(R, P.grocery)); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 3, Y(1.56) + r * 50 + 12, 15, 9); } shade(); });
  cell(2, 5, (R) => { person(R, 150, 1.7, true); counter(R, 0.98, '#8d8f8c', '#d7d9d6'); rr(40, Y(0.98) - 46, 56, 44, 3, '#2b2d2e'); g.fillStyle = '#7fd08a'; g.fillRect(46, Y(0.98) - 40, 44, 16); shelves(g, R, 180, Y(0.98) - 40, 64, 38, 1, P.grocery, 'can', 'rgba(0,0,0,0)', '#8d8f8c'); shade(); });
  cell(2, 6, (R) => { g.fillStyle = '#3a3a3a'; g.fillRect(30, Y(1.5), 196, 1.5 * M); for (let r = 0; r < 6; r++) for (let x = 36; x < 214; x += 30) { g.fillStyle = pick(R, P.grocery); g.fillRect(x, Y(1.47) + r * 48, 27, 42); g.fillStyle = pick(R, ['#fff', '#111', '#f4c20d']); g.fillRect(x + 3, Y(1.47) + r * 48 + 4, 21, 9); } shade(); });
  cell(2, 7, (R) => neon(R, 'OPEN', '#ff3b30', '#35d06a'));
  // family 3: services
  cell(3, 0, (R) => { g.fillStyle = '#b8bcc0'; g.fillRect(122, Y(0.42), 12, 0.42 * M); ell(128, Y(0.03), 46, 8, '#9a9ea2'); rr(78, Y(0.62), 100, 34, 8, '#1b1b1f'); rr(84, Y(1.25), 88, 126, 12, '#1b1b1f'); rr(66, Y(0.84), 14, 50, 4, '#b8bcc0'); rr(176, Y(0.84), 14, 50, 4, '#b8bcc0'); shade(); });
  cell(3, 1, (R) => { person(R, 70, 1.28, true); person(R, 196, 1.3, true); rr(60, Y(0.78), 140, 10, 3, '#f1f1ee'); g.fillStyle = '#d7d9d6'; g.fillRect(80, Y(0.74), 100, 0.74 * M); g.strokeStyle = '#2b2b2b'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, Y(0.8)); g.lineTo(128, Y(1.15)); g.lineTo(150, Y(1.05)); g.stroke(); ell(152, Y(1.04), 12, 7, '#fff3d0'); for (let k = 0; k < 6; k++) rr(92 + k * 9, Y(0.8) - 12, 6, 12, 1, pick(R, ['#e84a5f', '#b5179e', '#f6d55c', '#c1121f'])); shade(); });
  cell(3, 2, (R) => { washer(Y(0.87)); washer(Y(0.87) - 170); shade(); }); cell(3, 3, (R) => { washer(Y(0.87)); rr(40, Y(0.87) - 8, 176, 8, 2, '#c9ced0'); rr(70, Y(0.87) - 60, 110, 52, 6, pick(R, ['#3bb3c3', '#e9e4d8', '#d94f70'])); shade(); });
  cell(3, 4, (R) => { for (let k = 0; k < 3; k++) { const x = 44 + k * 84; g.fillStyle = '#2b2b2b'; g.fillRect(x - 26, Y(0.42), 4, 0.42 * M); g.fillRect(x + 22, Y(0.42), 4, 0.42 * M); rr(x - 34, Y(0.5), 68, 16, 5, '#3d5a73'); rr(x - 32, Y(0.95), 64, 80, 8, '#3d5a73'); } shade(); });
  cell(3, 5, (R) => { plant(R, 100, 1.5); rr(150, Y(0.5), 80, 0.5 * M, 6, '#d7d9d6'); shade(); }); cell(3, 6, (R) => { plant(R, 128, 1.7); shade(); });
  cell(3, 7, (R) => neon(R, 'OPEN', '#ff4fa3', '#39d0ff'));
  // family 4: lobbies, banks, home
  cell(4, 0, (R) => { person(R, 128, 1.74, true); counter(R, 1.1, pick(R, ['#3b2a1e', '#d9d2c2', '#2b2b2b']), '#c9c2b2'); rr(160, Y(1.1) - 26, 50, 24, 2, '#1b1b1f'); shade(); });
  cell(4, 1, (R) => { for (const x of [50, 206]) { g.fillStyle = '#c9a25a'; g.fillRect(x - 3, Y(0.98), 6, 0.98 * M); ell(x, Y(0.02), 20, 5, '#b08a3e'); ell(x, Y(1.0), 8, 8, '#d9b56a'); } g.strokeStyle = '#7a1f1f'; g.lineWidth = 8; g.beginPath(); g.moveTo(54, Y(0.93)); g.quadraticCurveTo(128, Y(0.5), 202, Y(0.93)); g.stroke(); });
  cell(4, 2, (R) => { for (const x of [70, 186]) { rr(x - 52, Y(1.62), 104, 1.62 * M, 4, '#6e7478'); rr(x - 40, Y(1.5), 80, 70, 3, '#12253a'); g.fillStyle = '#3f8fd0'; g.fillRect(x - 34, Y(1.5) + 6, 68, 58); g.fillStyle = '#dfe8ee'; lines(g, R, x - 28, Y(1.5) + 14, 50, 40, '#dfe8ee', 4); rr(x - 34, Y(1.05), 68, 40, 3, '#3a3e40'); rr(x - 30, Y(0.78), 60, 8, 2, '#1b1b1f'); } shade(); });
  cell(4, 3, (R) => { const col = pick(R, ['#6b7a6a', '#8a6f52', '#3d4a5a', '#b9a58a']); rr(10, Y(0.78), 236, 0.5 * M, 14, col); rr(4, Y(0.62), 34, 0.56 * M, 10, col); rr(218, Y(0.62), 34, 0.56 * M, 10, col); rr(26, Y(0.46), 204, 30, 8, col); for (const x of [60, 150]) rr(x, Y(0.74), 50, 44, 8, pick(R, ['#e9e4d8', '#c29b3a', '#a4472f'])); g.fillStyle = '#2b2622'; g.fillRect(22, Y(0.1), 10, 0.1 * M); g.fillRect(224, Y(0.1), 10, 0.1 * M); shade(); });
  cell(4, 4, (R) => { plant(R, 128, 1.85); shade(); });
  cell(4, 5, (R) => { g.fillStyle = '#8a6a2a'; g.fillRect(126, 0, 4, 120); for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, x = 128 + Math.cos(a) * 70, y = 150 + Math.sin(a) * 14; g.strokeStyle = '#b08a3e'; g.lineWidth = 3; g.beginPath(); g.moveTo(128, 122); g.quadraticCurveTo(x, 120, x, y); g.stroke(); const gr = g.createRadialGradient(x, y, 1, x, y, 28); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,220,150,.5)'); gr.addColorStop(1, 'rgba(255,210,130,0)'); g.fillStyle = gr; g.fillRect(x - 30, y - 30, 60, 60); } });
  cell(4, 6, (R) => { g.fillStyle = '#2b2622'; g.fillRect(126, Y(1.5), 4, 1.5 * M); ell(128, Y(0.02), 30, 5, '#2b2622'); poly('#e9dfc8', [[100, Y(1.72)], [156, Y(1.72)], [176, Y(1.4)], [80, Y(1.4)]]); const gr = g.createRadialGradient(128, Y(1.45), 4, 128, Y(1.4), 70); gr.addColorStop(0, 'rgba(255,236,190,.9)'); gr.addColorStop(1, 'rgba(255,214,140,0)'); g.fillStyle = gr; g.fillRect(50, Y(1.8), 156, 150); rr(150, Y(0.5), 90, 0.5 * M, 8, pick(R, ['#8a6f52', '#3d4a5a'])); shade(); });
  cell(4, 7, (R) => { g.strokeStyle = '#6b4a2a'; g.lineWidth = 6; g.beginPath(); g.moveTo(70, Y(0)); g.lineTo(118, Y(1.6)); g.moveTo(186, Y(0)); g.lineTo(138, Y(1.6)); g.moveTo(128, Y(0.1)); g.lineTo(128, Y(1.6)); g.stroke(); g.fillStyle = '#1b1b1f'; g.fillRect(52, Y(1.55), 152, 150); g.fillStyle = pick(R, ['#a4472f', '#27506b', '#c29b3a']); g.fillRect(60, Y(1.55) + 8, 136, 134); ell(128, Y(1.2), 34, 34, '#e9e4d8'); shade(); });
  return tex(THREE, c, true, true);
}
