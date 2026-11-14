// scales.js: what every dial's needle angle means. One table per instrument, used both to PRINT the face (faces.js) and to DRIVE the
// needle (cockpit.js), so a needle can never disagree with its own markings. Angles are degrees clockwise from 12 o'clock.
const lin = (v0, a0, v1, a1) => [[v0, a0], [v1, a1]];
export const SCALES = {
  asi: [[0, 0], [20, 22], [40, 62], [60, 104], [80, 146], [100, 188], [120, 230], [140, 272], [160, 314]],     // knots
  vsi: [[-3000, 100], [-2000, 145], [-1000, 200], [-500, 235], [0, 270], [500, 305], [1000, 340], [2000, 395], [3000, 440]],   // feet per minute; zero at 9 o'clock
  tach: lin(0, -135, 120, 135),        // percent, rotor and turbine on one face
  tq: lin(0, -135, 110, 135),          // percent torque
  tot: lin(0, -135, 10, 135),          // turbine outlet temperature, degrees C x 100
  fuel: lin(0, -120, 100, 120),        // percent of tank
  oilt: lin(-50, -135, 150, 135),      // degrees C
  oilp: lin(0, -135, 10, 135),         // bar
  volt: lin(16, -120, 32, 120),        // volts DC
  oat: lin(-40, -135, 60, 135),        // degrees C
};
export function angleOf(table, v) {
  if (v <= table[0][0]) return table[0][1]; const n = table.length; if (v >= table[n - 1][0]) return table[n - 1][1];
  for (let i = 1; i < n; i++) if (v <= table[i][0]) { const a = table[i - 1], b = table[i]; return a[1] + (b[1] - a[1]) * (v - a[0]) / (b[0] - a[0]); }
  return table[n - 1][1];
}
// the reverse (what a needle at this angle reads), for checking the instruments against the flight state
export function valueOf(table, ang) {
  const n = table.length; if (ang <= table[0][1]) return table[0][0]; if (ang >= table[n - 1][1]) return table[n - 1][0];
  for (let i = 1; i < n; i++) if (ang <= table[i][1]) { const a = table[i - 1], b = table[i]; return a[0] + (b[0] - a[0]) * (ang - a[1]) / (b[1] - a[1]); }
  return table[n - 1][0];
}
export const KT = 1.94384, FT = 3.28084, FIELD_FT = 33;      // the game's street level stands 33 ft above the sea (Madison Square is about that)
// what the altimeter reads: the skids' height over the sea, from the flight model's CG height (three.js y, metres; the CG rides 1.25 m up)
export const altFt = (y) => (y - 1.25) * FT + FIELD_FT;
// attitude ball: the window shows AI_SPAN degrees of pitch across its diameter; the strip tile holds +-AI_MAX
export const AI_SPAN = 50, AI_MAX = 40;
// compass degrees (0 = north, clockwise) from the flight model's heading (0 = east, counter-clockwise, radians)
export const compassDeg = (h) => ((90 - h * 180 / Math.PI) % 360 + 360) % 360;
