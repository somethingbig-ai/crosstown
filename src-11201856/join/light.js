// join/light.js (lead, helper uptown-join, Nov 19): the light on buildings, cars and people north of the line. Everything but the joined areas' own ground reads ONE
// ground light picture (world.shared.tLight / uHalf). The default map's holds the ground to 195 m north of the line and then repeats Midtown's rows, so a car at W 75th St
// was shaded by the towers of 34th. The pack's picture (assets/join/<pack>-light.webp: cut from the uptown map's own, from 400 m south of the line to 150 m past the
// areas) agrees with the default map's from 400 m south of the line to 195 m north of it (measured on 30,000 points a band: mean difference 7 of 255; README F).
// So while the camera is north of a point 100 m SOUTH of the line the shared picture IS the pack's, and south of it the default map's again (60 m of slack between the
// two so it does not flap): at the change every thing within about 300 m is lit the same by both. What stays wrong: north of the change point, Midtown further than
// 400 m south of the line and anything west of x -689 reads the pack's picture wrapped (far ground, small on screen); the walkers' own shade (near.js reads the
// default picture's pixels once at load). ?joinlight2=0 = the default map's picture everywhere, as before.
export function tick(game, J) {
  const P = game.P; if (P.get('joinlight2') === '0' || P.get('joinlight') === '0') return; const w = game.world, sh = w && w.shared, cam = w && w.camera && w.camera.position; if (!sh || !sh.tLight || !sh.uHalf || !cam) return;
  const L = J.light || (J.light = { on: false, flips: 0 }), LINE = J.box0[3], y = -cam.z; let mine = null, mk = null, my = -1e9;
  // packs.patch (item 5): one picture a pack. The camera's pack is the northmost one whose south side it has passed (100 m before it; 160 m to go back): rows stand on each other.
  for (const k in J.pk || {}) { const p = J.pk[k]; if (!p.shv) { if (p.lm && !p.__sh && J.lightOf) J.lightOf(p); continue; } const s0 = Math.min(...p.sets.map((q) => q.play[1])), y0 = s0 > LINE + 1 ? s0 : LINE; if (y > y0 - (L.on && L.pack === k ? 160 : 100) && y0 > my) { my = y0; mine = p.shv; mk = k; } }
  if (!mine && !L.on) return; const want = !!mine; if (!mine) mine = L.cur;
  if (want && L.on && L.pack !== mk) { /* from one pack's picture to the next one's */ sh.tLight.value = mine.tLight.value; sh.uHalf.value.copy(mine.uHalf.value); L.pack = mk; L.cur = mine; L.flips++; L.at = Math.round(y); }
  if (L.on && sh.tLight.value !== mine.tLight.value) { /* the map's own loader put a picture in meanwhile (its slabs follow the player): that one is the default's now */ L.keep.t = sh.tLight.value; sh.tLight.value = mine.tLight.value; sh.uHalf.value.copy(mine.uHalf.value); }
  if (want && !L.on) { L.keep = { t: sh.tLight.value, hx: sh.uHalf.value.x, hy: sh.uHalf.value.y }; sh.tLight.value = mine.tLight.value; sh.uHalf.value.copy(mine.uHalf.value); L.on = true; L.pack = mk; L.cur = mine; L.flips++; L.at = Math.round(y); }
  else if (!want && L.on) { sh.tLight.value = L.keep.t; sh.uHalf.value.set(L.keep.hx, L.keep.hy); L.on = false; L.flips++; L.at = Math.round(y); }
}
