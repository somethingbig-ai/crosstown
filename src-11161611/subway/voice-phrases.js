// subway/voice-phrases.js (subway lane, voice helper): WHAT is said. Pure (no browser, no three.js): imported by voice.js in the game, by
// tools/voice-list.mjs (the list of clips to render) and by tools/voice-test.mjs (node test over every station and track of the data).
// Matt through CHIEF, Nov 14 19:23Z: "the train announcer etc should sound JUST like the real thing": the wording is the real system's.
//   in the car, doors open:    "This is Forty-second Street, Bryant Park. Transfer is available to the seven train."
//   before the doors close:    "Stand clear of the closing doors, please."
//   pulling out:               "This is a Queens-bound F local train. The next stop is Forty-seventh, Fiftieth Streets, Rockefeller Center."
//   on the platform:           "There is a Brooklyn-bound F local train approaching the station. Please stand away from the platform edge."
// A phrase is a list of clip ids, with numbers between them for a pause in seconds (no number = the short gap between words). Two speakers, as the
// real system has: `car` (station and next-stop lines) and `safety` (the door line and the platform). New station = one clip; new line = three.
export const ROUTES = ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'N', 'Q', 'R', 'W', 'S'];      // every key of ROUTE_COL in subway.js
const TRUNKS = ['123', '456', '7', 'ACE', 'BDFM', 'NQRW', 'S'];      // lines that share tracks (the same colour in ROUTE_COL): no transfer line between them
export const trunk = (r) => TRUNKS.find((t) => t.includes(String(r))) || String(r);
// local or express, as each line runs through our part of the city (the same lists as data.lines[].local / express)
export const KIND = { 1: 'local', 2: 'express', 3: 'express', 4: 'express', 5: 'express', 6: 'local', 7: 'local', A: 'express', C: 'local', E: 'local', B: 'express', D: 'express', F: 'local', M: 'local', N: 'express', Q: 'express', R: 'local', W: 'local', S: '' };
// where each line is bound, the way the trains say it: [uptown way, downtown way]
const BOUND_WORDS = { queens: 'Queens-bound', bronx: 'Bronx-bound', brooklyn: 'Brooklyn-bound', uptown: 'uptown', downtown: 'downtown', hy: 'Hudson Yards-bound', gc: 'to Grand Central', tsq: 'to Times Square' };      // (gc, tsq: the shuttle's two ends, said AFTER the train: "the shuttle to Grand Central")
export const BOUND = { 1: ['bronx', 'downtown'], 2: ['bronx', 'brooklyn'], 3: ['uptown', 'brooklyn'], 4: ['bronx', 'brooklyn'], 5: ['bronx', 'brooklyn'], 6: ['bronx', 'downtown'], 7: ['queens', 'hy'], A: ['uptown', 'brooklyn'], C: ['uptown', 'brooklyn'], E: ['queens', 'downtown'],
  B: ['bronx', 'brooklyn'], D: ['bronx', 'brooklyn'], F: ['queens', 'brooklyn'], M: ['queens', 'brooklyn'], N: ['queens', 'brooklyn'], Q: ['uptown', 'brooklyn'], R: ['queens', 'brooklyn'], W: ['queens', 'downtown'], S: ['gc', 'tsq'] };
export const boundOf = (route, dir) => (BOUND[route] || ['uptown', 'downtown'])[dir > 0 ? 0 : 1];
// transfers: in the 18-station data the records that share st.cx are one complex. The older 3-station data has no cx: its two true ones are written here.
export const XFER = { herald: ['N', 'Q', 'R', 'W'], c602: [], bryant: ['7'] };

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ONES = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'], TENTH = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
export const ordinal = (n) => { n = +n; if (n >= 100) { const r = n % 100; return 'one hundred' + (r ? ' ' + ordinal(r) : 'th'); } if (n < 20) return ONES[n]; return n % 10 ? TENS[(n / 10) | 0] + '-' + ONES[n % 10] : TENTH[(n / 10) | 0]; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// station names as the trains say them. "34 St-Herald Sq" -> "Thirty-fourth Street, Herald Square"; "47-50 Sts-Rockefeller Ctr" -> "Forty-seventh, Fiftieth Streets, Rockefeller Center"
const SPOKEN = { '42 St-Port Authority': 'Forty-second Street, Port Authority Bus Terminal', '42 St-Port Authority Bus Terminal': 'Forty-second Street, Port Authority Bus Terminal' };
export function spokenName(name) { if (SPOKEN[name]) return SPOKEN[name]; if (name.includes('/')) return name.split('/').map((q) => spokenName(q.trim())).join(', ');      /* "5 Av/53 St" is said "Fifth Avenue, Fifty-third Street" (a slash is read out as a word) */
  return String(name).split(/\s*-\s*(?=[A-Za-z])|(?<=[A-Za-z])\s*-\s*/).map((part) => part.trim()
    .replace(/\b(\d+)-(\d+)\b/g, (m, a, b) => cap(ordinal(a)) + ', ' + cap(ordinal(b))).replace(/\b(\d+)\b(?=\s+(St|Sts|Av|Avs)\b)/g, (m, a) => cap(ordinal(a)))
    .replace(/\bSts\b/g, 'Streets').replace(/\bSt\b/g, 'Street').replace(/\bAvs\b/g, 'Avenues').replace(/\bAv\b/g, 'Avenue').replace(/\bSq\b/g, 'Square').replace(/\bCtr\b/g, 'Center').replace(/\bPl\b/g, 'Place').replace(/\bPk\b/g, 'Park')).join(', ');
}
export const routeWord = (r) => (r === 'S' ? 'shuttle' : ({ 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' })[r] || String(r));
const trainWords = (r) => routeWord(r) + (KIND[r] ? ' ' + KIND[r] : '') + ' train';      // "F local train"

// the fixed parts: id -> [speaker, the words, words before it (for the tune of the part; not spoken), words after it]
const EX = 'Forty-second Street, Bryant Park.';
export const PARTS = {
  'c-this': ['car', 'This is', '', EX], 'c-next': ['car', 'The next stop is', 'This is a Queens-bound F local train.', EX],
  'c-shuttle': ['car', 'This is the shuttle', '', 'to Grand Central.'],
  'c-thisa': ['car', 'This is a', '', 'Queens-bound F local train.'], 'c-thisan': ['car', 'This is an', '', 'uptown A express train.'],
  'c-xfer': ['car', 'Transfer is available to the', 'This is ' + EX, 'B, D, N and Q trains.'], 'w-and': ['car', 'and', 'Transfer is available to the B, D,', ''],
  'c-train': ['car', 'train.', 'Transfer is available to the seven', ''], 'c-trains': ['car', 'trains.', 'Transfer is available to the B, D, N and Q', ''],
  'c-last': ['car', 'This is the last stop on this train. Everyone please leave the train.', '', ''],
  'c-doors': ['safety', 'Stand clear of the closing doors, please.', '', ''],
  'a-there': ['safety', 'There is a', '', 'Queens-bound F local train approaching the station.'], 'a-therean': ['safety', 'There is an', '', 'uptown A express train approaching the station.'],
  'a-appr': ['safety', 'approaching the station.', 'There is a Queens-bound F local train', 'Please stand away from the platform edge.'],
  'a-edge': ['safety', 'Please stand away from the platform edge.', 'There is a Queens-bound F local train approaching the station.', ''],
  'n-1': ['safety', 'Ladies and gentlemen, for your safety, please do not lean on the doors, and do not hold the doors open.', '', ''],
  'n-2': ['safety', 'Backpacks and other large containers are subject to random search by the police.', '', ''],
  'n-3': ['safety', 'Please be careful of the gap between the platform and the train.', '', ''],
};
export const NOTICES = Object.keys(PARTS).filter((k) => /^n-/.test(k));
export const stClip = (st) => 'st-' + slug(st.name || st), lClip = (r) => 'l-' + r, bClip = (who, b) => (who === 'car' ? 'bc-' : 'bp-') + b, rClip = (who, r) => (who === 'car' ? 'rc-' : 'rp-') + r;
// every clip the game can ask for: [{ id, text, who, before, after }]
export function clipList(data) {
  const L = Object.entries(PARTS).map(([id, p]) => ({ id, who: p[0], text: p[1], before: p[2], after: p[3] })), seen = new Set();
  for (const [b, w] of Object.entries(BOUND_WORDS)) { if (/^to /.test(w)) { L.push({ id: bClip('car', b), who: 'car', text: w + '.', before: 'This is the shuttle', after: '' }, { id: bClip('pa', b), who: 'safety', text: w, before: 'There is a shuttle train', after: '' }); continue; } const an = /^[aeiou]/i.test(w) ? 'an' : 'a'; L.push({ id: bClip('car', b), who: 'car', text: w, before: 'This is ' + an, after: '' }, { id: bClip('pa', b), who: 'safety', text: w, before: 'There is ' + an, after: b === 'hy' ? '' : 'F local train approaching the station.' }); }      // (no words-after for these: with them the voice ran on into the next word, heard by the recogniser as "Bronx-bound F-")
  for (const r of ROUTES) { L.push({ id: rClip('car', r), who: 'car', text: trainWords(r) + '.', before: 'This is a Brooklyn-bound', after: 'The next stop is ' + EX }, { id: rClip('pa', r), who: 'safety', text: trainWords(r), before: 'There is a Brooklyn-bound', after: 'approaching the station.' });
    L.push({ id: lClip(r), who: 'car', text: routeWord(r).length === 1 ? r : routeWord(r), before: 'Transfer is available to the B,', after: r === 'W' || r === '7' ? '' : ', and Q trains.' }); }
  for (const st of data.stations) { const id = stClip(st); if (seen.has(id)) continue; seen.add(id); L.push({ id, who: 'car', text: spokenName(st.name) + '.', name: st.name, before: 'This is', after: '' }); }
  return L;
}
const NUM = (r) => (/^\d/.test(r) ? 0 : r === 'S' ? 2 : 1);
// the lines to transfer to, on a train of `route` at station st: the other lines of its complex that do not share this train's tracks
export function transfers(st, route, data) { const own = trunk(route), all = [...(st.routes || [])];
  if (data && st.cx !== undefined && st.cx !== null && data.stations.length) { for (const o of data.stations) if (o.id !== st.id && o.cx === st.cx) all.push(...(o.routes || [])); } else all.push(...(XFER[st.id] || []));
  return [...new Set(all.map(String).filter((r) => trunk(r) !== own))].sort((a, b) => NUM(a) - NUM(b) || (a < b ? -1 : a > b ? 1 : 0)); }

// ---- the phrases. Each returns the list of clips; text(seq) gives the words.
const AN = (b) => /^[aeiou]/i.test(BOUND_WORDS[b]);
// platform loudspeakers, a train about a stop away
export const arrival = (dir, route) => { const b = boundOf(route, dir); if (route === 'S') return ['a-there', rClip('pa', 'S'), bClip('pa', b), 'a-appr', 0.3, 'a-edge'];      /* "There is a shuttle train to Grand Central approaching the station." */ return [AN(b) ? 'a-therean' : 'a-there', bClip('pa', b), rClip('pa', route), 'a-appr', 0.3, 'a-edge']; };
// a train about to run through on a track with no platform here
export const passing = () => ['a-edge'];
// in the car, doors opening (+ the last-stop line where the map ends for this train)
export function thisIs(st, route, last, data) { const seq = ['c-this', stClip(st)], x = transfers(st, route, data);
  if (x.length) { seq.push(0.35, 'c-xfer'); x.forEach((r, i) => { if (i && i === x.length - 1) seq.push('w-and'); seq.push(lClip(r)); }); seq.push(x.length > 1 ? 'c-trains' : 'c-train'); }
  if (last) seq.push(0.5, 'c-last'); return seq; }
// pulling out: what train this is and where it stops next (without a route: only the next stop)
export const nextStop = (st, route, dir) => { const s = ['c-next', stClip(st)]; if (!route) return s; const b = boundOf(route, dir); if (route === 'S') return ['c-shuttle', bClip('car', b), 0.3, ...s];      /* "This is the shuttle to Times Square." */ return [AN(b) ? 'c-thisan' : 'c-thisa', bClip('car', b), rClip('car', route), 0.3, ...s]; };
export const lastStop = () => ['c-last'];
export const doorWarn = () => ['c-doors'];
export const notice = (i) => [NOTICES[((i % NOTICES.length) + NOTICES.length) % NOTICES.length]];
// the words of a phrase (texts: id -> words, from clipList)
export function text(seq, texts) { let s = ''; for (let i = 0; i < seq.length; i++) { const q = seq[i]; if (typeof q === 'number') continue; const nx = seq[i + 1], isL = /^l-/.test(q);
    let w = (texts && texts[q]) || (PARTS[q] && PARTS[q][1]) || (/^b[cp]-/.test(q) ? BOUND_WORDS[q.slice(3)] : /^rc-/.test(q) ? trainWords(q.slice(3)) + '.' : /^rp-/.test(q) ? trainWords(q.slice(3)) : isL ? (routeWord(q.slice(2)).length === 1 ? q.slice(2) : routeWord(q.slice(2))) : q);
    if (isL && typeof nx === 'string' && /^l-/.test(nx)) w += ','; s += (s ? ' ' : '') + w; } return s; }
// the clips a station can need (preloaded when the player comes down): its name, its lines' parts both ways, its transfers, the next stations' names, the fixed parts
export function clipsFor(st, data, next) { const ids = new Set(Object.keys(PARTS)); ids.add(stClip(st)); for (const n of next || []) if (n) ids.add(stClip(n));
  for (const r of st.routes || []) { for (const who of ['car', 'pa']) { ids.add(rClip(who, r)); for (const d of [1, -1]) ids.add(bClip(who, boundOf(r, d))); } for (const q of transfers(st, r, data)) ids.add(lClip(q)); } return [...ids]; }
