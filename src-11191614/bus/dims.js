// bus/dims.js: the bus's measures as the rest of the lane uses them. look.js (the model) exports the true ones (DIMS); these stand in until it
// loads, and fill anything it leaves out. Model frame: +x forward, +y up, +z the bus's right (kerb side). seats: [x, y, z, yaw] hip point and
// the way the sitter faces in the model frame (0 = forward, +PI/2 = towards +z, the kerb side; -PI/2 = towards the street side).
export const DIMS0 = (() => {
  const seats = [], F = 0.37, R = 0.72;
  for (let i = 0; i < 4; i++) { seats.push([2.9 - i * 0.78, F + 0.45, -0.9, Math.PI / 2 * (i < 2 ? 1 : 0)]); }        // street side, front: two side-facing over the wheel, then forward
  for (let i = 0; i < 3; i++) for (const z of [-0.98, -0.52]) seats.push([0.2 - i * 0.8, F + 0.45, z, 0]);              // street side pairs
  for (let i = 0; i < 3; i++) for (const z of [0.52, 0.98]) seats.push([2.6 - i * 0.8, F + 0.45, z, 0]);                // kerb side pairs ahead of the rear door
  for (let i = 0; i < 4; i++) for (const z of [-0.98, -0.52, 0.52, 0.98]) seats.push([-2.6 - i * 0.8, R + 0.45, z, 0]); // the raised rear
  for (const z of [-0.98, -0.5, 0, 0.5, 0.98]) seats.push([-5.55, R + 0.45, z, 0]);                                     // the back bench
  return { len: 12.2, wid: 2.59, hgt: 3.2, wheelbase: 7.2, radius: 0.49, axF: 3.9, axR: -3.3, floor: F,
    doors: { front: { x: 5.0, w: 0.9 }, rear: { x: -0.9, w: 1.0 } }, driver: [4.55, F + 0.62, -0.72], seats,
    aisle: [[5.0, 0.75], [4.9, 0.1], [3.4, 0.0], [-0.9, 0.0], [-2.1, 0.0], [-5.0, 0.0]], rearStep: [-0.9, 0.85],
    floorAt: (x) => (x > -1.7 ? F : x > -2.2 ? F + (R - F) * (-1.7 - x) / 0.5 : R), head: 1.62, sit: 0.72 };
})();
export function dimsFrom(look) { const D = Object.assign({}, DIMS0, look || {}); for (const k of ['doors', 'driver', 'seats', 'aisle', 'floorAt', 'rearStep']) if (!D[k] || (Array.isArray(D[k]) && !D[k].length)) D[k] = DIMS0[k]; return D; }
