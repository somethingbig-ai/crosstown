# src/bus/: who makes what (bus lane, Nov 15)

Frames: the game's map is x east, y north, metres. three.js scene: (x, up, -y). A vehicle at (x, y) heading h (atan2(dy, dx)) is drawn with
`position.set(x, z, -y); rotation.set(roll, h, pitch, 'YZX')`; so in the MODEL frame +X is forward, +Y up, +Z the bus's RIGHT (the kerb side,
where the doors are). Model origin: middle of the body's length and width, on the road.

## look.js (the model helper)  -- everything that is drawn of a bus
```js
export const DIMS = {
  len: 12.2, wid: 2.59, hgt: 3.2,          // metres; a 40 ft low-floor city bus
  wheelbase: 7.2, radius: 0.49, axF: 3.9, axR: -3.3,
  floor: 0.37,                              // floor height above the road, front half (low floor)
  doors: { front: { x: 5.0, w: 0.9 }, rear: { x: -0.9, w: 1.0 } },   // door-centre x; both on the +Z side
  driver: [x, y, z],                        // where a seated driver's hips go (model frame)
  seats: [[x, y, z, yaw], ...],             // every passenger seat: hip point and the way the sitter faces (0 = forward, +PI/2 = facing +Z... say which)
  aisle: [[x, z], ...],                     // a walkable polyline on the floor from the front door past the driver to the rear door and the back seats
  floorAt(x) -> y,                          // floor height along the aisle (the step up over the rear axle)
  cord: [[x, y, z], ...],                   // where the stop-request strips / buttons are (for the player's hand, optional)
};
export async function makeLook(game, opts) -> look
//   opts.signs = [{ num: 'M15', sel: true, head: 'South Ferry', via: 'via 2 Av' }, ...]   every destination sign that can be asked for (about 50)
//   opts.cap   = how many buses at most are drawn at once (12)
look.begin()                                 // once per rendered frame, before the adds
look.add(b)                                  // one bus:
//   b = { x, y, z, h, roll, pitch,          // pose
//         kneel: 0..1,                      // 1 = front right corner lowered about 7 cm
//         doorF: 0..1, doorR: 0..1,         // 1 = fully open
//         spin, steer, brake,               // wheel angle (rad), front-wheel steer (rad), brake lamps on
//         sign: i,                          // index into opts.signs; -1 = "NOT IN SERVICE"
//         stopReq: bool,                    // the "STOP REQUESTED" sign inside is lit
//         inside: bool,                     // the player is aboard THIS bus: draw the full interior, and nothing of the body may hide the view from a seat
//         riders: 0..1,                     // how full (seated figures seen through the windows, if you draw them)
//         night: 0..1, d }                  // interior lights / lamps; d = metres from the camera (pick the detail level)
look.end()
look.stats()                                 // { tris, draws } of the last frame
```
Rules: instanced (one draw per material group for all buses at a detail level, like src/streets/vehicles.js); three detail levels (near < 25 m with
door leaves that swing, wipers, mirrors, bike rack, roof pods, lamp units, wheels that spin and steer, the interior behind see-through glass;
mid < 120 m; far a few hundred triangles); budget: 12 buses in view must not cost more than 1 ms of main thread and 250k triangles in all.
Geometry is made in code (as src/heli/model/ is) or loaded from assets/bus/*.glb (draco, as the streets vehicles are): your choice; total
download for the bus under 1.5 MB. Use the game's lighting the way src/streets/vehicles.js does (facade.js BAKE_LIGHT_GLSL etc.) so a bus sits
in the street like the cars beside it, day, night and rain.
THE LOOK: a present-day New York city bus, as a PARODY of the look and never the real marks: deep blue front mask and lower skirt with a
yellow/gold swept stripe on white upper sides, amber LED destination sign above the windscreen ("M15  SOUTH FERRY  via 2 Av"), route number
on the kerb side and the rear, bike rack, roof air-conditioning pod, black window band, fleet number, our own invented operator name and badge
(NOT "MTA", not its logo, not "New York City Bus", not "Select Bus Service": ours says e.g. "CITY TRANSIT" and Select routes carry a red/blue
"+SELECT" mask), kneeling-bus and wheelchair pictograms, interior: blue hard seats in pairs facing forward and side-facing rows over the
wheels, yellow grab poles and stanchions, yellow stop strips, grey speckled floor with a yellow line behind the driver, fare box and reader by
the driver, the driver's screen, the "STOP REQUESTED" sign, advert cards above the windows (invented adverts), strip lights.

## Everything else (the lane lead): bus.js (install, the one hook), net.js (routes on the road graph), fleet.js (the schedule, the buses in
traffic, stops, doors), ride.js (the player aboard, at the wheel), stops.js + lanes.js (pole signs, shelters, red lanes: the stops helper),
sound.js (engine, doors, kneel beeper, chime, voice: the stops helper).

## stops.js (the stops helper)  -- loaded by bus.js when present; sets game.busStopsOwn (the street furniture's rule-placed stops stand down)
```js
export async function makeStops(game, stops) -> S
//   stops = [{ i, x, y, h, name, routes: ['M15', 'M15+'], sel, shelter, kx, ky, kerb }]   map metres
//   x, y = the pole (on the sidewalk, 0.55 m in from the kerb); h = heading of the traffic passing it (the roadway is to the LEFT of someone
//   standing at the pole looking along h... i.e. the kerb line runs along h and the road is at (x + sin h * -0.55, y - cos h * -0.55));
//   kx, ky = the kerb point where the front door stops; shelter = this stop wants one if there is room (you check the room: walls, trees,
//   hydrants, other furniture via game.statics and the sidewalk's depth; put it upstream of the pole, back to the building side or the kerb side as NYC does)
S.update(camX, camY)        // each rendered frame (instanced, culled by distance; must cost nothing when no stop is near)
export async function makeLanes(game, runs) -> L
//   runs = [{ key, seq: [{ e, dir, s0 }] }]: the blocks (game.roads edges, direction) of each Select line; paint the kerb-side lane red
//   (game.roads.lanePos(e, dir, laneCount - 1, s) is its centre line; e.lw its width) with white "BUS ONLY" lettering once a block; not in junctions
```
## sound.js (the stops helper)  -- loaded by bus.js when present
```js
export function makeSound(game) -> A
A.bus(b, dt)      // per rendered frame for each bus within 90 m: b = { id, x, y, v, acc, state: 'run'|'in'|'dwell'|'player', doorF, doorR, kneel, inside, d }
A.frame(dt)       // once per rendered frame after the A.bus calls (buses not heard this frame fade out)
A.chime()         // stop requested (the rider is aboard)
A.say(kind, stop, line)   // kind 'next' | 'this' | 'last' | 'route'; stop = { name: '5 Av / W 42 St', i }; line = { num: 'M4', sel, head, via }
```
