// bus/voice_text.js (bus lane, stops+sound helper, Nov 15): WHAT the bus's voice says, as plain text. Pure (no DOM, no audio): used by sound.js in
// the game, by tools/voice-list.mjs for the renderer, and by the tests. A stop's name as the data has it ('5 Av / W 42 St') becomes
//   show: 'Fifth Avenue and West 42nd Street'   (the caption)        say: 'Fifth Avenue and West forty-second Street'   (what the speech engine is given)
// and each announcement is a list of CLIPS that lie one after another in assets/bus/voice/voice.mp3 (voice.json says where):
//   p-next "Next stop:"   p-this "This is"   p-last "This is the last stop on this bus."   (route announcements: p-this + rb-<num> + h-<head>)
//   a-<part> "Fifth Avenue and" (a first half, spoken with its "and" so the tune carries on)   s-<part> "West 42nd Street." (a last half)
//   rb-<num> "an M 4 bus to" / "an M 15 Select bus to"   h-<head> "Midtown, 32nd Street and Fifth Avenue."
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD1 = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const TENTH = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export function cardinal(n) { n = Math.round(n); if (n < 20) return ONES[n] || 'zero'; if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''); const h = Math.floor(n / 100), r = n % 100; return ONES[h] + ' hundred' + (r ? ' ' + cardinal(r) : ''); }
// street numbers the way New Yorkers say them: 42nd = forty-second, 125th = one twenty-fifth, 110th = one hundred tenth, 101st = one-oh-first
export function ordinalWords(n) {
  n = Math.round(n); if (n < 20) return ORD1[n]; if (n < 100) return n % 10 ? TENS[Math.floor(n / 10)] + '-' + ORD1[n % 10] : TENTH[n / 10];
  const h = Math.floor(n / 100), r = n % 100; if (r === 0) return ONES[h] + ' hundredth'; if (r < 10) return ONES[h] + ' oh ' + ORD1[r]; if (r === 10) return ONES[h] + ' hundred tenth'; return ONES[h] + ' ' + ordinalWords(r);
}
export function ordinalDigits(n) { const t = n % 100, o = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th'); }
const WORD = { E: 'East', W: 'West', N: 'North', S: 'South', Av: 'Avenue', Ave: 'Avenue', AV: 'Avenue', St: 'Street', Blvd: 'Boulevard', Dr: 'Drive', Sq: 'Square', Pl: 'Place', Pk: 'Park', Pkwy: 'Parkway', Rd: 'Road', Ft: 'Fort', Ctr: 'Center', Hts: 'Heights', Plz: 'Plaza', Ter: 'Terrace', Ln: 'Lane', Of: 'of', The: 'the', Lex: 'Lexington', Bway: 'Broadway' };
const SAYWORD = { FDR: 'F D R', GW: 'George Washington', UN: 'U N' };
// one half of a stop's name: 'W 42 St' -> { show: 'West 42nd Street', say: 'West forty-second Street' }
export function spokenPart(p) {
  let t = String(p).trim().replace(/\s+/g, ' ').replace(/^Av(enue)? Of The Americas$/i, 'Avenue of the Americas').replace(/(\d)\s*AV\b/, '$1 Av');
  const w = t.split(' '), show = [], say = [];
  for (let i = 0; i < w.length; i++) {
    const k = w[i], nx = w[i + 1] || '';
    if (/^\d+$/.test(k)) { const n = +k; if (/^(Av|Ave|AV|Avenue)$/.test(nx) && n <= 12) { show.push(cap(ORD1[n])); say.push(cap(ORD1[n])); } else if (/^(St|Street|Av|Ave|Avenue|Dr|Pl|Rd)$/.test(nx)) { show.push(ordinalDigits(n)); say.push(ordinalWords(n)); } else { show.push(k); say.push(cardinal(n)); } continue; }
    if (k === 'St' && i === 0) { show.push('Saint'); say.push('Saint'); continue; }
    if ((k === 'E' || k === 'W' || k === 'N' || k === 'S') && i > 0 && i === w.length - 1) { show.push(WORD[k]); say.push(WORD[k]); continue; }
    if (SAYWORD[k]) { show.push(k); say.push(SAYWORD[k]); continue; }
    const x = WORD[k] !== undefined && !(k.length === 1 && i > 0 && !/^\d/.test(nx) && i < w.length - 1 && w[i - 1] === 'Avenue') ? WORD[k] : k; show.push(x); say.push(x);
  }
  return { show: show.join(' '), say: say.join(' ') };
}
export const slug = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// a stop's whole name: '5 Av / W 42 St' -> parts [{show, say, id}], show 'Fifth Avenue and West 42nd Street'
export function spokenName(name) {
  const parts = String(name || '').split(/\s*\/\s*|\s+&\s+/).map((p) => p.trim()).filter(Boolean).slice(0, 2).map((p) => { const s = spokenPart(p); s.id = slug(s.show); return s; });
  if (parts.length === 2 && parts[0].id === parts[1].id) parts.pop();
  return { parts, show: parts.map((p) => p.show).join(' and '), say: parts.map((p) => p.say).join(' and ') };
}
// where a bus is going, as the sign's short text has it -> how a person would say it. The table holds every sign of today's data; anything new falls to the rules.
const HEADS = {
  'Harlem 147 St': 'Harlem, 147th Street', 'Soho Centre St': 'SoHo, Centre Street', 'Washington Heights Broadway-168 St': 'Washington Heights, Broadway and 168th Street',
  'East Village 8 St': 'the East Village, 8th Street', 'St Nicholas A 193 St': 'Saint Nicholas Avenue and 193rd Street', 'Washington Heights Cloisters': 'Washington Heights, the Cloisters',
  'Midtown 32 St & 5 Av': 'Midtown, 32nd Street and Fifth Avenue', 'Washington Heights GW Bridge': 'Washington Heights, George Washington Bridge', '31 St 6 Av': '31st Street and Sixth Avenue',
  '14 St': '14th Street', 'Riverbank 145 St': 'Riverbank, 145th Street', 'West Village Abingdon Sq': 'the West Village, Abingdon Square', 'Midtown West Columbus Circle': 'Midtown West, Columbus Circle',
  'Lower East Side Delancey-FDR': 'the Lower East Side, Delancey Street and F.D.R. Drive', 'Chelsea Piers 11 Av': 'Chelsea Piers, Eleventh Avenue', 'East Harlem 125 St': 'East Harlem, 125th Street',
  'South Ferry': 'South Ferry', '125 St': '125th Street', 'Lincoln Center 66 St': 'Lincoln Center, 66th Street', 'East Side Avenue C': 'the East Side, Avenue C', 'Chelsea Piers 12AV': 'Chelsea Piers, Twelfth Avenue',
  'Yorkville 91 St': 'Yorkville, 91st Street', 'Clinton 11 Av': 'Clinton, Eleventh Avenue', 'East Side FDR Dr': 'the East Side, F.D.R. Drive', 'Javits Center 12 Av': 'Javits Center, Twelfth Avenue',
  'Waterside': 'Waterside', 'Port Authority Bus Terminal': 'Port Authority Bus Terminal', 'East Side U N-1 Av': 'the East Side, United Nations and First Avenue', 'West Side Pier 12 Av': 'the West Side, Twelfth Avenue pier',
  'East Side 49 St-1 Av': 'the East Side, 49th Street and First Avenue', 'West Side 42 St Pier': 'the West Side, 42nd Street pier', '44 St 6 Av': '44th Street and Sixth Avenue',
  'East Side 55 St-1 Av': 'the East Side, 55th Street and First Avenue', 'West Side Broadway-72 St': 'the West Side, Broadway and 72nd Street', 'Ft George': 'Fort George',
  'East Village 3 Av-6 St': 'the East Village, Third Avenue and 6th Street', 'East Village 6 St': 'the East Village, 6th Street', 'City Hall': 'City Hall', 'West Harlem 129 St': 'West Harlem, 129th Street', '41 St': '41st Street',
};
// digits in a shown text -> words for the speech engine ('32nd Street' -> 'thirty-second Street', 'F.D.R.' -> 'F D R')
export function sayOf(show) { return String(show).replace(/(\d+)(st|nd|rd|th)\b/g, (m, n) => ordinalWords(+n)).replace(/\b(\d+)\b/g, (m, n) => cardinal(+n)).replace(/F\.D\.R\./g, 'F D R'); }
export function spokenHead(head) {
  const h = String(head || '').trim(); let show = HEADS[h];
  if (!show) { const ps = h.split(/\s*[-&\/]\s*/).filter(Boolean).map((p) => spokenPart(p).show); show = ps.join(' and '); }
  return { show, say: sayOf(show), id: slug(show) };
}
// 'M15+' / 'M15' with sel -> { show: 'M15 Select', say: 'M fifteen Select', id: 'm15-select' }
export function spokenRoute(num, sel) {
  const m = /^([A-Za-z]+)(\d+)([A-Za-z]*)(\+?)$/.exec(String(num || '').trim()); if (!m) return { show: String(num), say: String(num), id: slug(num) };
  const s = !!sel || m[4] === '+', base = m[1].toUpperCase() + m[2] + m[3].toUpperCase();
  return { show: base + (s ? ' Select' : ''), say: m[1].toUpperCase().split('').join(' ') + ' ' + (+m[2] >= 100 && +m[2] % 100 < 10 ? cardinal(Math.floor(+m[2] / 100)) + ' oh ' + cardinal(+m[2] % 100) : +m[2] >= 100 ? cardinal(Math.floor(+m[2] / 100)) + ' ' + cardinal(+m[2] % 100) : cardinal(+m[2])) + (m[3] ? ' ' + m[3].toUpperCase() : '') + (s ? ' Select' : ''), id: slug(base + (s ? ' select' : '')) };
}
// one announcement -> { text (the caption), clips: [clip ids in order], say }
export function phrase(kind, stop, line) {
  const clips = [], name = stop && stop.name ? spokenName(stop.name) : null;
  const nameClips = () => { if (!name) return; const p = name.parts; if (p.length === 2) clips.push('a-' + p[0].id, 's-' + p[1].id); else if (p.length) clips.push('s-' + p[0].id); };
  if (kind === 'next' && name) { clips.push('p-next'); nameClips(); return { text: 'Next stop: ' + name.show, say: 'Next stop: ' + name.say + '.', clips }; }
  if (kind === 'this' && name) { clips.push('p-this'); nameClips(); return { text: 'This is ' + name.show, say: 'This is ' + name.say + '.', clips }; }
  if (kind === 'last') { if (name) { clips.push('p-this'); nameClips(); } clips.push('p-last'); return { text: (name ? 'This is ' + name.show + '. ' : '') + 'This is the last stop on this bus.', say: (name ? 'This is ' + name.say + '. ' : '') + 'This is the last stop on this bus.', clips }; }
  if (kind === 'route' && line) { const r = spokenRoute(line.num, line.sel), h = spokenHead(line.head); clips.push('p-this', 'rb-' + r.id, 'h-' + h.id);      /* the route with its 'an' and 'bus to' is ONE take ('an M 15 Select bus to'): as three takes the recogniser heard 'This is ad ... boss two' */ return { text: 'This is an ' + r.show + ' bus to ' + h.show, say: 'This is an ' + r.say + ' bus to ' + h.say + '.', clips }; }
  return null;
}
// every clip the data can ask for: { id: { text (given to the speech engine), show } }
export function clipList(data) {
  const C = { 'p-next': { text: 'Next stop:', show: 'Next stop:' }, 'p-this': { text: 'This is', show: 'This is' }, 'p-last': { text: 'This is the last stop on this bus.', show: 'This is the last stop on this bus.' },
 };
  for (const s of data.stops) { const n = spokenName(s.n || s.name), p = n.parts; if (p.length === 2) { C['a-' + p[0].id] = { text: p[0].say + ' and', show: p[0].show + ' and' }; C['s-' + p[1].id] = { text: p[1].say + '.', show: p[1].show }; } else if (p.length) C['s-' + p[0].id] = { text: p[0].say + '.', show: p[0].show }; }
  for (const r of data.routes) { const x = spokenRoute(r.id, r.sel); C['rb-' + x.id] = { text: 'an ' + x.say + ' bus to', show: 'an ' + x.show + ' bus to' }; for (const d of r.dirs) { const h = spokenHead(d.head); C['h-' + h.id] = { text: h.say + '.', show: h.show }; } }
  return C;
}
