// build.js: every mesh of one level of detail, as soups: { body, glass, door, doorGlass, rivets, trim, doorTrim, lamps, hub, blades, tailHub, tailBlades }.
// Used by the bake (lanes/heli/items/model/bake.mjs, which also adds sky occlusion) and, if the baked file is missing, by model.js at load.
import { buildAirframe } from './shape.js';
import { buildRotorParts } from './rotorgeo.js';
export function assemble(D, q) {
  const A = buildAirframe(D, q), R = buildRotorParts(D, q);
  if (q > 0) { A.body.append(A.door); A.glass.append(A.doorGlass); }
  const out = { body: A.body, glass: A.glass, lamps: A.lamps, hub: R.hub, hubArms: R.hubArms, blades: R.blades, tailHub: R.tailHub, tailBlades: R.tailBlades };
  if (q === 0) { out.door = A.door; out.doorGlass = A.doorGlass; out.rivets = A.rivets; out.trim = A.trim; out.doorTrim = A.doorTrim; }
  return out;
}
