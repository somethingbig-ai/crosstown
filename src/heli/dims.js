// dims.js: the one sheet of measurements every helicopter part builds to (model, cockpit, flight, cameras, sound, wash).
// The aircraft is a generic single-turbine light utility helicopter of the AS350 / H125 class (three-blade main rotor, two-blade tail
// rotor on the right of the boom, skids). No maker's marks anywhere: the operator is the made-up "Crosstown Air".
// MODEL SPACE: metres, origin on the ground under the main rotor mast, +X forward (nose), +Y up, +Z right (the pilot sits on the RIGHT).
// The flight model's body frame is the same axes moved up to the centre of gravity (CG).
export const DIMS = {
  // overall
  noseX: 3.35, tailX: -7.58,            // fuselage ends (10.93 m long)
  rotorR: 5.345, rotorY: 3.14,          // main rotor radius and the height of the blade plane at the hub
  blades: 3, chord: 0.35, rotorCW: true, // seen from above the main rotor turns clockwise (so torque swings the nose LEFT; the tail rotor pushes it back)
  rpm: 390, tailRpm: 2086,
  tailRotorR: 0.93, tailRotor: [-6.25, 1.98, 0.42],   // hub, on the right side of the fin
  cg: [0, 1.25, 0],
  // skids: two tubes, bottom at y = 0
  skidZ: 1.085, skidFront: 1.55, skidRear: -1.45, skidTube: 0.045,
  contacts: [[1.5, 0, 1.085], [1.5, 0, -1.085], [-1.4, 0, 1.085], [-1.4, 0, -1.085]],
  // cabin (inside envelope the shell must stay outside of, and the cockpit builds inside of)
  floorY: 0.72, ceilY: 2.02, cabinHalfW: 0.80, cabinFrontX: 2.35, cabinRearX: -0.55,
  // people and controls
  pilotSeat: [1.02, 0.72, 0.40],        // seat reference point: floor under the right front seat (cushion top is 0.38 above)
  copilotSeat: [1.02, 0.72, -0.40],
  pilotEye: [1.05, 1.74, 0.40],         // design eye point of the pilot
  panel: { x: 1.92, y: 1.22, halfW: 0.52, h: 0.42, tilt: 0.26 },   // instrument panel face: centre, half width, height, lean back from vertical (rad)
  doorR: { x0: 0.25, x1: 1.85, y0: 0.74, y1: 1.98 },               // front right door opening (the pilot's), hinged at its front edge
  // lights
  navRed: [-0.2, 1.05, -1.0], navGreen: [-0.2, 1.05, 1.0], strobe: [-7.2, 2.9, 0], landingLight: [2.2, 0.55, 0],
  // rough hull for collisions (points in model space): nose, belly, tail skid, fin top, rotor tips are added from rotorR
  hull: [[3.2, 1.0, 0], [-7.5, 1.4, 0], [-7.2, 2.9, 0], [-6.9, 0.75, 0], [0.4, 0.5, 0], [0.5, 1.2, 0.95], [0.5, 1.2, -0.95]],
};
