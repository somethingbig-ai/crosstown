// interiors/slots.js (lanes/shops/interiors): the storefront slots that can be walked into, keyed "<building id>:<bay key>" as in SHOPS.json.
// kind = which interior is built (interiors/build.js); type / role = what storefronts.js builds the bay as (forced, so the front matches the room
// even without shops.json). Read by streets/storefronts.js (the fenced "interiors" lines) and by interiors/interiors.js.
export const IN_SLOTS = {
  '3457:65': { kind: 'deli', type: 'deli', role: 'shop' },          // W 25th St, south side, 6th Ave - Broadway, 150 m from the spawn (survey: deli). The nearer 3492:193 stands under a sidewalk shed: its bay is not a plain front
  '537:962': { kind: 'pizza', type: 'pizza', role: 'shop' },         // Broadway, east side, W 27th - W 28th (survey: pizza, DOHMH)
  '3444:65': { kind: 'hotel', type: 'hotel', role: 'lobby' },        // W 25th St, north side, 6th Ave - Broadway (survey: hotel, OSM)
  '1624:0': { kind: 'pharmacy', type: 'pharmacy', role: 'shop' },    // 5th Ave, east side, E 22nd - E 23rd (survey: pharmacy, OSM)
};
