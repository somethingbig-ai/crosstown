// garages/slots.js (lanes/shops/garages): the storefront bays that are parking garages you can drive into, keyed "<building id>:<bay key>" as in
// SHOPS.json (rows of type "parking": NYC DCWP garage licences and OSM). room = the rectangle behind the mouth that tools/gar_fit.mjs found inside the
// building (bay frame: u from ua to ub along the wall, D metres deep); the game only re-checks it. Read by streets/storefronts.js (its "garages" lines).
// A row goes in here only when lanes/shops/tools/gar_site.mjs passes it: the building tile's front wall lies on the bay's wall line, the far city
// (far.glb) has nothing inside the room, and nothing solid stands between the kerb and the mouth. (Out for those reasons: 3344:129 E 22nd St, tile
// front 0.38 m proud of the line, so the old front showed through; 106027:198 W 43rd St, far.glb walls inside; 2542:257 W 31st St, a sidewalk shed. 710:131 E 21st St passes the tool but lies on the map's south edge: the test car could not be driven to it.)
export const GAR_SLOTS = {
  '828:193': { room: { ua: -6.6, ub: 8.85, D: 30 } },          // E 22nd St, south side, Broadway - Park Ave South (DCWP garage licence, 932 Broadway), 270 m from the spawn
  '2472:66': { room: { ua: -8.85, ub: 8.85, D: 35 } },         // W 32nd St, south side, 7th Ave - 6th Ave (OSM parking, 132 West 32nd St: the bay beside its row 2472:65), 680 m
  '102514:321': { room: { ua: -8.6, ub: 8.85, D: 29 } },       // W 35th St, north side, 6th Ave - 5th Ave (OSM parking, 9 West 35th St), 820 m
  '105298:65': { room: { ua: -8.85, ub: 8.85, D: 30 } },       // W 43rd St, north side, 8th Ave - 7th Ave, Midtown north (OSM parking, 249 West 43rd St), 1.6 km
};
