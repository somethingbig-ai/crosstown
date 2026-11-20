// park/bridge.js (park lane): a hand-built stone arch bridge from the data's deck line. First: GAPSTOW BRIDGE over the Pond's neck
// (1896, Howard & Caudwell: rough Manhattan schist, one segmental arch, a humped deck between solid stone parapets). Proportions from
// photographs and the park's own figures: the arch spans about 13.4 m and rises about 3.6 m over the water, the bridge is about 23 m long.
// Later bridges follow the pattern: SPEC[name] gives span, rise, parapet and hump; the line, width and end heights come from the data.
import * as THREE from 'three';
import { lit } from './mat.js';
import { BASE } from './ground.js';

export const SPEC = {
  'Gapstow Bridge': { span: 13.4, clear: 3.6, parapet: 1.05, wall: 0.5, ring: 0.75, hump: 0.9 },
  default: { span: 9, clear: 3.0, parapet: 1.0, wall: 0.45, ring: 0.6, hump: 0.5 },
};

let MAT = null;
export function material(game, S) {
  if (MAT) return MAT;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.94, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  // rubble schist laid in rough courses: blocks of uneven length, each its own grey, dark recessed joints; the deck (vertex colour red) is path asphalt
  const WALL = !(game.P && game.P.get('parkwall') === '0');
  MAT = lit(m, game.world.shared, { key: 'bridge', spec: 0.3, night: 2.8      /* handoff-9: stone 0.30 .. 0.50 -> 0.10 .. 0.19 and the deck 1.2 -> 0.36 by day, back at night (mat.js) */, pars: 'uniform sampler2D tRock, tAsph;', uniforms: { tRock: S.tRock, tAsph: S.tAsph },
    body: `vec3 an = abs(bakeN); vec2 f0 = an.y > 0.7 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
           // look pass k1 (critic r1: "tiled even stone"): the courses wander and the stones differ in height and length (rubble, not ashlar); the stone's
           // albedo is on the lawn's scale (0.30 .. 0.50 -> 0.10 .. 0.19); creeper hangs on the upright faces in patches (dull red and brown in November)
           // handoff-8 (critic r3: "brick tiling, too small"; Gapstow's stones are half a metre and more): on a bridge (vertex colour b 0.98) the courses, the stones, their
           // wander and their joints are twice the size; the park's walls and houses (structs.js) keep theirs. ?parkstone=0 = as before
           float sz = 1.0 + step(vColor.b, 0.99), rh = 0.34 * sz;
           vec2 f = f0 + vec2(vnoise(f0.yx * 1.3 / sz + 5.0) - 0.5, vnoise(f0 * vec2(0.55, 1.7) / sz) - 0.5) * vec2(0.34, 0.30) * sz;
           float row = floor(f.y / rh), off = hash21(vec2(row, 3.0)) * 2.0, len = (0.36 + 0.85 * hash21(vec2(row, 9.0))) * sz;
           vec2 cell = vec2(floor((f.x + off) / len), row), q = vec2(fract((f.x + off) / len) * len, fract(f.y / rh) * rh);
           float jw = (0.02 + 0.03 * hash21(cell + 4.1)) * sz, jt = (1.0 - smoothstep(jw * 0.4, jw, min(min(q.x, len - q.x), min(q.y, rh - q.y))));
           vec3 rk = texture2D(tRock, f / 1.4 + hash32(cell).xy).rgb; rk = mix(vec3(dot(rk, vec3(0.333))), rk, 0.4);
           vec3 stone = rk * mix(vec3(0.100, 0.096, 0.092), vec3(0.190, 0.175, 0.155), hash21(cell + 1.7)) * (0.7 + 0.6 * fbm(f * 2.0)) * (1.0 - 0.8 * jt);
           stone = mix(stone, stone * vec3(0.5, 0.62, 0.38), smoothstep(0.55, 0.8, fbm(f0 * 0.6 + 4.0)) * 0.6);
           float cre = smoothstep(0.55, 0.64, fbm(f0 * vec2(0.45, 0.30) + 13.0)) * step(an.y, 0.7) * step(0.35, hash21(floor(f0 * 23.0)));
           stone = mix(stone, mix(vec3(0.050, 0.014, 0.010), vec3(0.030, 0.026, 0.010), hash21(floor(f0 * 23.0) + 2.0)), cre);
           ${WALL ? `// handoff-9 (critic, batch 7: "wall almost black with a rusty red patch"): the perimeter wall and the park's houses (structs.js, vertex colour g 0.98) shared
           // Gapstow's stone with its creeper and moss. They have their own now: a plain grey-buff stone, no creeper, little moss, and in shade it keeps a part
           // of the sky's light as the bridge's stone does (below), so a wall turned from the sun reads as stone beside the bridge's sunlit face. ?parkwall=0 = as before
           float wl = step(vColor.g, 0.99);
           vec3 wst = rk * mix(vec3(0.175, 0.165, 0.145), vec3(0.245, 0.228, 0.196), hash21(cell + 1.7)) * (0.8 + 0.4 * fbm(f * 2.0)) * (1.0 - 0.7 * jt);
           wst = mix(wst, wst * vec3(0.62, 0.70, 0.52), smoothstep(0.62, 0.86, fbm(f0 * 0.6 + 4.0)) * 0.35);
           stone = mix(stone, wst, wl); pkNight = mix(pkNight, 1.9, wl);` : 'float wl = 0.0;'}
           vec3 deck = texture2D(tAsph, vWPos.xz / 4.0).rgb; deck = mix(vec3(dot(deck, vec3(0.333))), deck, 0.5) * 0.36;
           diffuseColor.rgb = mix(stone, deck, step(vColor.r, 0.99));      // vertex colour: white = stone, r 0.98 = the walk (three multiplies it in afterwards: both near 1)
           // handoff-8 (critic r3: "a black slab wall at Gapstow's right end"): no stray block: rays from the camera hit the bridge's own outer face over its abutment
           // (probe f8a), which stands in shade there and drew near black beside the sunlit stone. A bridge's stone in shade keeps a little of the sky's light.
           totalEmissiveRadiance += stone * uSunColor * (0.04 * (sz - 1.0) + 0.09 * wl * step(0.99, vColor.r));` });
  return MAT;
}

// the deck lines of a structure: the data's `decks` ([{ path, w, pts: [[x, y, h] ...] }], heights in the relief frame, from the lidar), or for a
// structure that has only a `line` (the test park) one deck with a sine hump over the line.
function decksOf(T, st, sp, wl) {
  if (st.decks && st.decks.length) return st.decks.filter((d) => d.pts && d.pts.length > 1).map((d) => ({ w: d.w || st.w || 6, pts: d.pts.map((p) => [p[0], p[1], p[2]]) }));
  const L = st.line; if (!L || L.length < 2) return [];
  const A = L[0], B = L[L.length - 1], zA = T.ground(A[0], A[1]), zB = T.ground(B[0], B[1]), crown = Math.max((wl !== undefined ? wl : Math.min(zA, zB) - 1.5) + sp.clear + sp.ring, Math.max(zA, zB) + sp.hump), pts = [];
  for (let k = 0; k <= 16; k++) { const t = k / 16; pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, zA + (zB - zA) * t + (crown - (zA + zB) / 2) * Math.sin(Math.PI * t)]); }
  return [{ w: (st.w || 6) - 2 * sp.wall, pts }];
}
// a deck line resampled every `step` metres: [{ x, y, z, s, tx, ty }]
function stations(pts, step) {
  const out = []; let s = 0;
  for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-3) continue; const n = Math.max(1, Math.round(L / step));
    for (let q = (out.length ? 1 : 0); q <= n; q++) { const t = q / n; out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t, s: s + L * t, tx: (b[0] - a[0]) / L, ty: (b[1] - a[1]) / L }); } s += L; }
  for (let k = 1; k + 1 < out.length; k++) { const a = out[k - 1], b = out[k + 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1; out[k].tx = (b.x - a.x) / L; out[k].ty = (b.y - a.y) / L; }
  return out;
}

// build(game, S (ground.shared), structure, waterLevel) -> { group, decks (terrain decks), corridors, info }
export function build(game, S, st, waterLevel) {
  const T = game.terrain, sp = SPEC[st.name] || SPEC.default, wl = st.water_level !== undefined ? st.water_level : waterLevel;
  const pos = [], col = [], STONE = [1, 1, game.P && game.P.get('parkstone') === '0' ? 1 : 0.98]      /* handoff-8: b 0.98 = a bridge's stone, drawn twice the size (material, above) */, DECK = [0.98, 1, 1], sg = game.statics, decks = [], corridors = [], info = { decks: 0 };
  const quad = (a, b, c, d, k) => { for (const v of [a, b, c, a, c, d]) { pos.push(v[0], v[1], v[2]); col.push(k[0], k[1], k[2]); } };
  const UNDER = !(game.P && game.P.get('parkunder') === '0');      /* handoff-13: people and vehicles pass under a deck as well as over it */
  const water = st.over === 'water' || (st.kind === 'bridge' && wl !== undefined);
  const all = decksOf(T, st, sp, wl);
  // a side of a deck that runs along another deck of the same structure (a footpath beside the drive on one arch) gets no face and no parapet
  const beside = (dk, x, y) => { for (const o of all) { if (o === dk) continue; const P = o.pts, R = o.w / 2 + 1.2; for (let k = 0; k + 1 < P.length; k++) { const ax = P[k][0], ay = P[k][1], dx = P[k + 1][0] - ax, dy = P[k + 1][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); if (Math.hypot(x - ax - dx * t, y - ay - dy * t) < R) return true; } } return false; };
  for (const dk of all) {
    const wall = water ? sp.wall : 0.4, inner = dk.w / 2 + (st.carries === 'drive' || st.carries === 'transverse' ? 0.5 : 0.1), hw = inner + wall, par = water ? sp.parapet : (st.carries === 'path' ? 1.0 : 0.85);
    const Q = stations(dk.pts, 0.5), n = Q.length; if (n < 3) continue; const len = Q[n - 1].s;
    // handoff-13, two levels (terrain.js T.level): up = this deck's parapet segments, dn = the segments of the level under it (made only with the switch on)
    const up = [], dn = [], seg = (a, b) => dn.push(sg.addSeg(a[0], a[1], b[0], b[1], 0, 'bridge')), pt = (k, o) => [Q[k].x - Q[k].ty * o, Q[k].y + Q[k].tx * o];
    const P = (q, o, z) => [q.x - q.ty * o, BASE + z, -(q.y + q.tx * o)], G = (q, o) => T.ground(q.x - q.ty * o, q.y + q.tx * o);
    if (water) {
      // a stone arch over water: one segmental arch (a circle through the springings at the water and the crown of the opening) under the deck's hump
      const level = wl !== undefined ? wl : Math.min(Q[0].z, Q[n - 1].z) - 1.5; let crown = -1e9; for (const q of Q) crown = Math.max(crown, q.z); crown = Math.max(crown, level + 1.6 + sp.ring);
      const span = Math.min(sp.span, len - 3), rise = crown - sp.ring - level, Rr = (span * span / 4 + rise * rise) / (2 * rise), zc = level + rise - Rr, foot = level - 1.2;
      const under = (s) => { const d = s - len / 2; return Math.abs(d) < span / 2 ? Math.max(foot, zc + Math.sqrt(Math.max(0, Rr * Rr - d * d))) : foot; };
      // look pass k1 (critic r1: "dead-straight top"): the parapet's line bows up to the middle of the bridge and is a little uneven, as rubble coping is
      const bow = (q) => q.z + par + 0.32 * Math.sin(Math.PI * Math.max(0, Math.min(1, q.s / len))) + 0.05 * Math.sin(q.s * 2.1) * Math.sin(q.s * 0.7 + 1.0);
      for (let k = 0; k + 1 < n; k++) { const a = Q[k], b = Q[k + 1], ua = under(a.s), ub = under(b.s);
        for (const sd of [1, -1]) { const o = sd * hw, oi = sd * inner, f = (p, q, r, t, kk) => (sd > 0 ? quad(p, q, r, t, kk) : quad(t, r, q, p, kk));
          f(P(b, o, ub), P(a, o, ua), P(a, o, bow(a)), P(b, o, bow(b)), STONE);                    // outer face (spandrel and parapet in one plane)
          f(P(a, oi, a.z), P(b, oi, b.z), P(b, oi, bow(b)), P(a, oi, bow(a)), STONE);              // parapet, inner face
          f(P(a, o, bow(a)), P(a, oi, bow(a)), P(b, oi, bow(b)), P(b, o, bow(b)), STONE); }      // coping
        quad(P(a, -inner, a.z), P(b, -inner, b.z), P(b, inner, b.z), P(a, inner, a.z), DECK);              // the walk
        if (ua > foot || ub > foot) quad(P(a, hw, ua), P(b, hw, ub), P(b, -hw, ub), P(a, -hw, ua), STONE); }      // the vault's underside
      for (const [q, first] of [[Q[0], true], [Q[n - 1], false]]) for (const sd of [1, -1]) { const a = P(q, sd * hw, bow(q)), b = P(q, sd * inner, bow(q)), c = P(q, sd * inner, foot), d = P(q, sd * hw, foot); if (first === (sd > 0)) quad(a, b, c, d, STONE); else quad(d, c, b, a, STONE); }      // parapet ends
      for (const sd of [1, -1]) for (let k = 0; k + 4 < n; k += 4) { const a = Q[k], b = Q[Math.min(n - 1, k + 4)], o = sd * (inner + 0.05); up.push(sg.addSeg(a.x - a.ty * o, a.y + a.tx * o, b.x - b.ty * o, b.y + b.tx * o, par, 'bridge')); }
      // under the bridge (a swimmer): the opening is the arch's span; the faces beside it and the two jambs through the bridge are solid
      if (UNDER) { let k0 = 0, k1 = n - 1; while (k0 + 1 < n && Q[k0].s < len / 2 - span / 2) k0++; while (k1 > 0 && Q[k1].s > len / 2 + span / 2) k1--;
        for (const o of [hw, -hw]) { seg(pt(0, o), pt(k0, o)); seg(pt(k1, o), pt(n - 1, o)); } seg(pt(k0, hw), pt(k0, -hw)); seg(pt(k1, hw), pt(k1, -hw)); info.open = +(Q[k1].s - Q[k0].s).toFixed(1); }
      Object.assign(info, { len: +len.toFixed(1), span: +span.toFixed(1), crown: +crown.toFixed(2), water: +level.toFixed(2), rise: +rise.toFixed(2), ends: [+Q[0].z.toFixed(2), +Q[n - 1].z.toFixed(2)] });
    } else {
      // a way carried over a lower way (the park's arches): the way's surface where it stands clear of the ground, a stone face on each side with an
      // arched opening where the ground falls away under it (the lower way's cut), a parapet along the raised part
      const gap = [[], []], raw = [[], []], lo = [[], []], RING = 0.7; let hi = 0;
      for (let e = 0; e < 2; e++) { const o = e ? -hw : hw; for (let k = 0; k < n; k++) { const g = G(Q[k], o); hi = Math.max(hi, Q[k].z - g); raw[e].push(Q[k].z - g); gap[e].push(beside(dk, Q[k].x - Q[k].ty * o, Q[k].y + Q[k].tx * o) ? 0 : Q[k].z - g); lo[e].push(g - 0.25); }
        for (let k = 0; k < n; k++) { if (gap[e][k] < 2.0) continue; let k1 = k; while (k1 + 1 < n && gap[e][k1 + 1] >= 2.0) k1++; const mid = (Q[k].s + Q[k1].s) / 2, half = (Q[k1].s - Q[k].s) / 2 + 0.25;
          for (let q = k; q <= k1; q++) { const u = (Q[q].s - mid) / half; lo[e][q] = Math.min(Q[q].z - RING, Q[q].z - gap[e][q] + (gap[e][q] - RING) * Math.sqrt(Math.max(0, 1 - u * u))); } k = k1; } }
      // under the arch: on each face the opening is every run of stations with 2 m or more of air under the deck (where the arched opening is drawn);
      // the face beside it is solid, and so are the jambs that join the opening's ends on the two faces (the abutments); an opening on one face only is shut.
      // The opening is read from the air under the face itself (raw), also on a face that runs along a sister deck (three paths side by side on one arch:
      // that face has no stone, gap 0, yet the road passes under it); an opening that runs to the deck's end has no abutment there (the deck ends over
      // the cut: the lower way's own wall stands there); faces whose openings do not pair get no jamb and are not shut.
      if (UNDER) { const R = [[], []]; for (let e = 0; e < 2; e++) { const o = e ? -hw : hw; let s0 = -1;
          for (let k = 0; k <= n; k++) { const solid = k < n && gap[e][k] >= 0.3 && gap[e][k] < 2.0; if (solid && s0 < 0) s0 = k; else if (!solid && s0 >= 0) { seg(pt(Math.max(0, s0 - 1), o), pt(Math.min(n - 1, k), o)); s0 = -1; } }
          for (let k = 0; k < n; k++) { if (raw[e][k] < 2.0) continue; let k1 = k; while (k1 + 1 < n && raw[e][k1 + 1] >= 2.0) k1++; R[e].push([k, k1]); k = k1; } }
        if (R[0].length === R[1].length) R[0].forEach((a, i) => { const b = R[1][i]; if (a[0] > 0 && b[0] > 0) seg(pt(a[0], hw), pt(b[0], -hw)); if (a[1] < n - 1 && b[1] < n - 1) seg(pt(a[1], hw), pt(b[1], -hw)); info.open = +(Q[a[1]].s - Q[a[0]].s).toFixed(1); });
        else for (let e = 0; e < 2; e++) if (!R[1 - e].length) for (const a of R[e]) seg(pt(a[0], e ? -hw : hw), pt(a[1], e ? -hw : hw)); }
      const up_ = (k) => gap[0][k] > 0.3 || gap[1][k] > 0.3 || Q[k].z - G(Q[k], 0) > 0.3;
      for (let k = 0; k + 1 < n; k++) { const a = Q[k], b = Q[k + 1]; if (!up_(k) && !up_(k + 1)) continue;
        const za = (q, o) => Math.max(q.z, G(q, o)) + 0.04;
        quad(P(a, -inner, za(a, -inner)), P(b, -inner, za(b, -inner)), P(b, 0, za(b, 0)), P(a, 0, za(a, 0)), DECK); quad(P(a, 0, za(a, 0)), P(b, 0, za(b, 0)), P(b, inner, za(b, inner)), P(a, inner, za(a, inner)), DECK);
        quad(P(a, hw, a.z - RING), P(b, hw, b.z - RING), P(b, -hw, b.z - RING), P(a, -hw, a.z - RING), STONE);      // the soffit
        for (let e = 0; e < 2; e++) { const sd = e ? -1 : 1; if (gap[e][k] < 0.3 && gap[e][k + 1] < 0.3) continue; const o = sd * hw, oi = sd * inner, f = (p, q, r, t, kk) => (sd > 0 ? quad(p, q, r, t, kk) : quad(t, r, q, p, kk));
          f(P(b, o, lo[e][k + 1]), P(a, o, lo[e][k]), P(a, o, a.z + par), P(b, o, b.z + par), STONE); f(P(a, oi, a.z), P(b, oi, b.z), P(b, oi, b.z + par), P(a, oi, a.z + par), STONE); f(P(a, o, a.z + par), P(a, oi, a.z + par), P(b, oi, b.z + par), P(b, o, b.z + par), STONE);
          if (k % 4 === 0 || gap[e][k] < 0.3) { const c = Q[Math.min(n - 1, k + 4 - (k % 4))], oc = sd * (inner + 0.05); up.push(sg.addSeg(a.x - a.ty * oc, a.y + a.tx * oc, c.x - c.ty * oc, c.y + c.tx * oc, par, 'bridge')); } } }
      info.rise = +hi.toFixed(2);
    }
    decks.push(T.addDeck(UNDER ? { pts: Q.map((q) => [q.x, q.y, q.z]), hw: inner, up, dn } : { pts: Q.map((q) => [q.x, q.y, q.z]), hw: inner })); info.decks++;
    corridors.push({ ax: Q[0].x, ay: Q[0].y, bx: Q[n - 1].x, by: Q[n - 1].y, hw });
  }
  const group = new THREE.Group(); group.name = 'park_bridge:' + (st.name || st.id);
  if (pos.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(game, S)); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = group.name; group.add(mesh); }
  return { group, decks, corridors, info };
}
