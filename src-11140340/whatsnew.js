// whatsnew.js: the "What's new" list on the start screen (feedback lane, Nov 14; player 6b805c: "There's no changelog").
// Newest first. The lead adds one entry per ship, in plain words a player would use; only things that are LIVE go in.
// Only the newest MAX entries are shown. No dependencies: index.html's small module script renders it; node can test it.
export const MAX = 4;
export const NEWS = [
  ['Nov 14', ['Subway entrances where they really are, and one station you can walk down into (42 St-Bryant Park) with trains', 'A person you hit no longer sinks into the car', 'Cars you ram get thrown instead of standing like rock', 'Traffic stops for a body in the road and goes round it', 'After the police take you down you wake up somewhere you can walk out of', 'Get in through the passenger door when the driver side is blocked', 'A package can be collected on foot', 'The car leans the right way in turns', 'Shops are the right kind for their street', 'People hit by a car or shot stop at walls and parked cars', 'The start screen tells you when your browser is drawing without a graphics card']],
  ['Nov 13', ['The map now runs north to about W 48th St', 'Jump with Space', 'Police and a wanted level', 'Road-closed barriers and a banner where the map ends (the old "invisible walls")', 'People run from a drawn gun, and drivers react', 'Car doors open when you get in; you walk round the car, not through it', 'A stuck car gets pulled free']],
  ['Nov 12', ['Things you hit move and break: signs, bikes, tables, fences', 'Cars dent in a crash', 'Much less screen shake when shooting; you can shoot through car windows', 'No more freeze after pressing Play', 'Traffic no longer drives through you or your car']],
  ['Nov 11', ['Controllers work on Windows and Linux', 'The static noise is gone', 'Full screen (\\ key), frame-rate counter (0 key), a Feedback button you can find']],
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function html(news = NEWS, max = MAX) {
  const rows = news.slice(0, max).map(([day, items]) => '<div style="margin:6px 0 2px;font-weight:600;color:#ffd27a">' + esc(day) + '</div><ul style="margin:0;padding-left:1.2em">' + items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>').join('');
  return '<summary style="cursor:pointer;color:#ffd27a;list-style-position:inside">What\'s new, from your reports</summary><div style="text-align:left;max-height:11.5em;overflow:auto;margin-top:4px;padding:2px 8px 6px;background:rgba(255,255,255,.05);border-radius:6px">' + rows + '</div>';
}
