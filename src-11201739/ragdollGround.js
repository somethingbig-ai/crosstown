// Map coordinates are east/north; the skeleton uses east/up/south.
export function ragdollGround(game, x, z, height = 0, contact, stairOnly = false) {
  if (contact) contact.stair = null;
  const y = -z;
  const subway = game.subway;
  if (!subway?.units?.size) return game.statics.onSidewalk(x, y) ? 0.15 : 0;
  let street, best = -Infinity;
  for (const unit of subway.units.values()) {
    const walk = unit.walk;
    if (!walk) continue;
    for (const f of walk.near(x, y)) {
      // At or above the sidewalk cutoff, both street heights exclude covered floors.
      if (height >= 0.15 - 0.25 && f.k !== 'street') continue;
      const dx = x - f.x, dy = y - f.y;
      const u = dx * f.ca + dy * f.sa;
      if (Math.abs(u) > f.l / 2 || Math.abs(dy * f.ca - dx * f.sa) > f.w / 2) continue;
      let floor = f.z0;
      const down = f.l / 2 + (f.z0 > f.z1 ? u : -u);
      const open = f.k === 'street' && down < walk.meta.lOpen;
      if (!open && height >= -0.25) {
        if (height >= 0.15 - 0.25) continue;
        street ??= game.statics.onSidewalk(x, y) ? 0.15 : 0;
        if (height >= street - 0.25) continue;
      }
      if (f.stair) {
        const rise = walk.meta.rise;
        const n = f.n || Math.round(Math.abs(f.z1 - f.z0) / rise);
        floor = Math.max(f.z0, f.z1) - rise * Math.min(n, 1 + Math.floor(down * n / f.l));
      }
      if (floor > best && floor <= height + 0.22 && (open || height <= walk.ceilAt(f, u))) {
        best = floor;
        if (contact) {
          contact.stair = f.stair ? f : null;
          contact.open = open;
          contact.down = down;
          contact.rise = walk.meta.rise;
        }
      }
    }
  }
  // Stair-only pose probes discard street contacts. Avoid the sidewalk polygon query on a miss.
  if (stairOnly && !Number.isFinite(best)) return -Infinity;
  return Number.isFinite(best) ? best : (street ?? (game.statics.onSidewalk(x, y) ? 0.15 : 0));
}
