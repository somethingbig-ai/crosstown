// standin.js: a plain cabin structure (roof, door frames, windscreen post, nose tub) around the cockpit.
// It is NOT the aircraft's shell: model.js builds that. It is used for two things only:
//   1. as the occluder set when the cockpit's sky-visibility shading is baked (items/cockpit/bake_ao.mjs), so the cabin is shaded as if
//      a roof and walls stood round it;
//   2. drawn while the real shell does not exist yet (the lead's stand-in body is hidden from inside), so pilot's-eye frames can be judged.
import { Builder, M, GRAIN, rbox, tube, grid } from './geo.js';

const PAINT = { c: 0xb9bcbd, r: 0.42, g: GRAIN.plastic, s: 8, w: 0.5, bump: 0.25 }, DARK = { c: 0x141516, r: 0.5, g: GRAIN.plastic, s: 20, w: 0.4, bump: 0.4 }, SEAL = { c: 0x0c0c0d, r: 0.8, g: GRAIN.none, w: 0.3, bump: 0 };
export function buildStandinShell(DIMS) {
  const B = new Builder(), T = M.t, mul = M.mul, FY = DIMS.floorY, CY = DIMS.ceilY, HW = DIMS.cabinHalfW, d = DIMS.doorR;
  // roof (to just ahead of the pilot's head) and its front beam
  B.add(rbox(1.62 - DIMS.cabinRearX + 0.1, 0.06, HW * 2 + 0.14, 0.025, 2, 8, 0, 6), PAINT, T((1.62 + DIMS.cabinRearX - 0.1) / 2, CY + 0.036, 0));
  // rear wall and the fixed sides behind the doors
  B.add(rbox(0.05, CY - FY + 0.1, HW * 2 + 0.14, 0.02, 2, 0, 6, 6), PAINT, T(DIMS.cabinRearX - 0.03, (CY + FY) / 2, 0));
  for (const s of [-1, 1]) {
    const z = s * (HW + 0.03);
    B.add(rbox(d.x0 - DIMS.cabinRearX, 0.56, 0.05, 0.02, 2, 3, 3, 0), PAINT, T((d.x0 + DIMS.cabinRearX) / 2, FY + 0.26, z));       // lower rear side
    B.add(rbox(0.075, CY - FY + 0.06, 0.06, 0.02, 2, 0, 8, 0), PAINT, T(d.x0 - 0.03, (CY + FY) / 2, z));                              // door rear post
    B.add(rbox(0.075, CY - FY + 0.06, 0.06, 0.02, 2, 0, 8, 0), PAINT, T(DIMS.cabinRearX + 0.25, (CY + FY) / 2, z));
    // door front post, leaning back with the windscreen
    B.add(rbox(0.07, 1.36, 0.06, 0.02, 2, 0, 8, 0), PAINT, mul(T(1.75, (CY + FY) / 2 + 0.02, s * (HW + 0.005)), M.rz(0.24)));
    B.add(rbox(1.40, 0.07, 0.06, 0.02, 2, 6, 0, 0), PAINT, T(0.93, CY - 0.01, z));                                                    // roof rail over the door
    B.add(rbox(1.72, 0.10, 0.05, 0.02, 2, 6, 0, 0), PAINT, T(1.06, FY - 0.03, z));                                                    // sill beam
    // door's own lower skin and window rail (the inner trim panel is the cockpit's)
    B.add(rbox(1.56, 0.52, 0.02, 0.008, 2, 6, 3, 0), PAINT, T(1.05, FY + 0.29, s * (HW + 0.022)));
    B.add(rbox(1.58, 0.045, 0.05, 0.015, 2, 6, 0, 0), SEAL, T(1.05, FY + 0.555, s * (HW + 0.01)));
    // nose tub side
    B.add(rbox(0.95, 0.34, 0.04, 0.015, 2, 4, 2, 0), PAINT, mul(T(2.30, FY + 0.13, s * (HW - 0.07)), M.ry(s * 0.16)));
  }
  // windscreen centre post (dark) and the sill the windscreen stands on
  B.add(tube([[2.56, 1.20, 0], [2.20, 1.66, 0], [1.66, CY + 0.02, 0]], 0.022, 8, 10), DARK);
  B.add(rbox(0.06, 0.05, HW * 2 - 0.1, 0.02, 2, 0, 0, 6), PAINT, T(2.74, FY + 0.30, 0));
  B.add(rbox(0.09, 0.07, HW * 2 + 0.1, 0.025, 2, 0, 0, 6), PAINT, T(1.64, CY + 0.02, 0));
  // floor of the nose and what is under the cabin floor
  B.add(grid(0.55, HW * 2 - 0.1, 6, 10), { c: 0x45484c, r: 0.78, g: GRAIN.plastic, s: 9, w: 1.0, bump: 0.9 }, mul(T(2.60, FY + 0.001, 0), M.rx(-Math.PI / 2)));
  B.add(rbox(3.5, 0.04, HW * 2 + 0.1, 0.015, 1, 8, 0, 4), PAINT, T(1.15, FY - 0.03, 0));
  return B.build();
}
