// park/water.js (park lane): a water body of the park (the Pond, later the Lake, the Reservoir, the Meer): a flat sheet at the data's level,
// dark and green as park water is, mirroring the sky and rippling a little. Its edge is a low wall of collision (water is not walkable ground
// in this pass); the wall is left open under a bridge's deck (corridors = [{ ax, ay, bx, by, hw }]).
import * as THREE from 'three';
import { lit } from './mat.js';
import { BASE } from './ground.js';

let MAT = null, MIR = null;
// mirror(game): the still water mirrors the trees and the towers. The scene is drawn once more from the camera's mirror image under the water's
// level (the three.js Reflector's arithmetic: mirrored eye, near plane tilted onto the water), at half size, every second frame, in a frame
// callback of its own (never inside the game's own draw), and only while a water sheet was on screen in the last 0.4 s. `?parkmirror=0`: sky only.
function mirror(game) {
  if (MIR !== null) return MIR; const Q = game.P; if ((Q && Q.get('parkmirror') === '0') || typeof requestAnimationFrame === 'undefined') return (MIR = false);
  const world = game.world, R = world.renderer, cam = world.camera, scene = world.scene;
  const rt = new THREE.WebGLRenderTarget(1024, 576, { type: THREE.HalfFloatType, depthBuffer: true }); rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter; rt.texture.generateMipmaps = false;
  const vc = new THREE.PerspectiveCamera(), M = new THREE.Matrix4(), plane = new THREE.Plane(), n = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(), cp = new THREE.Vector3(), view = new THREE.Vector3(), rot = new THREE.Matrix4(), look = new THREE.Vector3(), tgt = new THREE.Vector3(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const mir = { U: { tMirror: { value: rt.texture }, uMirM: { value: M }, uMirOn: { value: 0 } }, seen: -1e9, level: 0, dist: 1e9, who: null, meshes: new Set(), draws: 0, ms: 0, err: null, frame: 0, seenF: -9, sync: false };
  let fr = 0;
  const off = () => { mir.U.uMirOn.value = 0; if (MAT) MAT.envMapIntensity = 0.32; };
  const draw = () => { requestAnimationFrame(draw); fr++; if (mir.err) return; if (performance.now() - mir.seen > 400) return off(); if ((fr & 1) && mir.U.uMirOn.value) return; once(); };
  const once = () => {
    P0.set(0, mir.level, 0); cp.setFromMatrixPosition(cam.matrixWorld); if (cp.y <= mir.level + 0.05) return off();
    const t0 = performance.now(), old = { rt: R.getRenderTarget(), xr: R.xr.enabled, sh: R.shadowMap.autoUpdate, nu: R.shadowMap.needsUpdate }, hid = [];
    try {
      view.subVectors(P0, cp).reflect(n).negate().add(P0); rot.extractRotation(cam.matrixWorld); look.set(0, 0, -1).applyMatrix4(rot).add(cp); tgt.subVectors(P0, look).reflect(n).negate().add(P0);
      vc.position.copy(view); vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(n); vc.lookAt(tgt); vc.near = cam.near; vc.far = cam.far; vc.layers.mask = cam.layers.mask; vc.updateMatrixWorld(); vc.projectionMatrix.copy(cam.projectionMatrix); vc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
      M.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
      plane.setFromNormalAndCoplanarPoint(n, P0).applyMatrix4(vc.matrixWorldInverse); clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const e = vc.projectionMatrix.elements; q.x = (Math.sign(clip.x) + e[8]) / e[0]; q.y = (Math.sign(clip.y) + e[9]) / e[5]; q.z = -1; q.w = (1 + e[10]) / e[14]; clip.multiplyScalar(2 / clip.dot(q)); e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;
      for (const m of mir.meshes) if (m.visible) { m.visible = false; hid.push(m); }
      R.xr.enabled = false; R.shadowMap.autoUpdate = false; R.shadowMap.needsUpdate = false; R.setRenderTarget(rt); R.clear(); R.render(scene, vc);
      mir.U.uMirOn.value = 1; if (MAT) MAT.envMapIntensity = 0.04; mir.draws++; mir.ms = performance.now() - t0;
    } catch (e) { mir.err = String(e && e.message); off(); console.log('[game] park: mirror failed: ' + mir.err); }
    finally { for (const m of hid) m.visible = true; R.setRenderTarget(old.rt); R.xr.enabled = old.xr; R.shadowMap.autoUpdate = old.sh; R.shadowMap.needsUpdate = old.nu; } };
  mir.once = once;
  // lead lake-helifire, Nov 18 (Matt on the trailer: "lake is flickering"): the mirror picture was drawn in a frame callback of its own, every second callback,
  // and switched off after 400 ms of wall clock without a water sheet drawn. A film or a still is stepped and drawn by hand and gets a callback only now and
  // then, so there the Lake's picture was redrawn at uneven moments and could go from mirror to sky map and back. Now the mirror belongs to the game's own
  // frame: world.render is wrapped, and just before each frame the sheets are looked at with the camera as it stands (in the scene, in reach, in the view);
  // if one is, its mirror is drawn (every second DRAWN frame, as before), if none is, the mirror is off. The same for the live loop, a film and a still, and
  // a sheet coming into view has its mirror on its first frame. ?parkmirrorsync=0 = the callback as before.
  if (!(Q && Q.get('parkmirrorsync') === '0') && typeof world.render === 'function') { mir.sync = true; const render0 = world.render, pm = new THREE.Matrix4(), fru = new THREE.Frustum();
    const inScene = (o) => { for (; o; o = o.parent) { if (!o.visible) return false; if (o === scene) return true; } return false; };
    world.render = function (t, focus) { mir.frame++;
      if (!mir.err) { try { cam.updateMatrixWorld(); fru.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); let best = null, bd = 1e9;
        for (const m of mir.meshes) { const u = m.userData.mir; if (!u || !inScene(m)) continue; const d = Math.hypot(cam.position.x - u.cx, -cam.position.z - u.cy); if (d - u.rr > u.MD || !fru.intersectsObject(m)) continue; const dd = m === mir.who ? d - 1 : d; if (dd < bd) { bd = dd; best = m; } }
        if (!best) { if (mir.U.uMirOn.value) off(); } else { mir.who = best; mir.dist = bd; mir.level = best.userData.mir.lv; mir.seen = performance.now(); mir.seenF = mir.frame; if (!((mir.frame & 1) && mir.U.uMirOn.value)) once(); } } catch (e) { mir.err = String(e && e.message); off(); console.log('[game] park: mirror failed: ' + mir.err); } }
      return render0.call(this, t, focus); }; }
  else requestAnimationFrame(draw);
  return (MIR = mir);
}
function material(game) {
  if (MAT) return MAT;
  // critic r2 (Nov 17): the Pond still read as a milky pale-teal slab with tree shadows on it. Cause: three r170 ignores a material's envMapIntensity
  // when the environment comes from scene.environment (WebGLRenderer: m_uniforms.envMapIntensity.value = scene.environmentIntensity), so the 0.20 /
  // 0.32 / 0.04 set here never arrived and the sheet mirrored the sky map at the scene's full 1.1 by Fresnel, over a mirror picture held down to 0.27.
  // Now: with the mirror on, the sky map and the sun's highlight are off (pkSpec 0) and the mirror picture is the reflection, by Fresnel (dark looking
  // down, bright at grazing angles); with the mirror off (far, ?parkmirror=0) the sky map shows only at middle angles and the grazing band is dark, as a
  // reflected tree line is; the sheet takes no cast shadows. ?parkwater=0 = the water as before.
  const OLD = !!(game.P && game.P.get('parkwater') === '0'), RIP = !OLD && !(game.P && game.P.get('parkripple') === '0');      // handoff-8: ripples and the browner tint; ?parkripple=0 = the water of handoff-6
  const m = new THREE.MeshStandardMaterial({ color: OLD ? new THREE.Color(0.020, 0.022, 0.011) : new THREE.Color(0.012, 0.012, 0.006), roughness: 0.1, metalness: 0.0, envMapIntensity: 0.20 })      /* critic r1, Nov 16: the Pond read milky pale green; mirror tint 0.40/0.45/0.35 -> 0.27/0.28/0.20, sky 0.32 -> 0.20 */;
  const mir = mirror(game), MU = mir ? mir.U : { tMirror: { value: null }, uMirM: { value: new THREE.Matrix4() }, uMirOn: { value: 0 } };
  m.userData.old = OLD;
  MAT = lit(m, game.world.shared, { key: 'water', night: 1.7      /* handoff-9: at night the Pond takes the sky's reflection again (pkSpec back to 1) and its old tint (0.020 -> 0.012 by day): mat.js */, uniforms: MU, pars: 'uniform float uTime; uniform sampler2D tMirror; uniform mat4 uMirM; uniform float uMirOn;',
    body: `float mur = fbm(vec2(w.x, -w.y) * 0.05); diffuseColor.rgb *= 0.7 + 0.7 * mur;
           float lf = smoothstep(0.80, 0.86, vnoise(vec2(w.x, -w.y) * 1.3)) * smoothstep(0.55, 0.75, fbm(vec2(w.x, -w.y) * 0.08 + 5.0));      // drifts of floating leaves
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.060, 0.018), lf); pkRough = mix(0.1, 0.8, lf);
           if (uMirOn > 0.5) { vec4 mp = uMirM * vec4(vWPos, 1.0); float md = distance(cameraPosition, vWPos); vec2 mq = vWPos.xz * 1.9 + uTime * 0.12;
             vec2 muv = mp.xy / max(mp.w, 0.001) + (vec2(vnoise(mq), vnoise(mq * 1.3 + 7.0)) - 0.5) * vec2(0.003, 0.011) * clamp(30.0 / md, 0.15, 1.0);      // nearly still: the picture trembles a little, more up and down than sideways
             ${RIP ? `// handoff-8 (critic r3: "the mirror is perfect"): a breath of wind ruffles the sheet in slow drifting patches (the sheet has no measure of how far a bank is: the
             // patches stand in for open water) and there the picture breaks into short wavering streaks; between the patches a faint ripple only
             float gust = smoothstep(0.40, 0.66, fbm(vec2(w.x, -w.y) * 0.04 + vec2(uTime * 0.015, 3.0))); vec2 rq = vWPos.xz * vec2(2.2, 5.5) + vec2(uTime * 0.10, uTime * 0.22);
             muv += (vec2(vnoise(rq + 11.0), vnoise(rq * 1.6 + 23.0)) - 0.5) * vec2(0.004, 0.022) * (0.25 + 0.75 * gust) * clamp(30.0 / md, 0.2, 1.0);` : ''}
             float cosv = clamp(normalize(cameraPosition - vWPos).y, 0.0, 1.0), fres = 0.03 + 0.97 * pow(1.0 - cosv, 5.0);
             vec3 mc = texture2D(tMirror, clamp(muv, 0.002, 0.998)).rgb; mc = mc / (1.0 + ${OLD ? '0.9' : '0.7'} * dot(mc, vec3(0.333)));      // look pass k1: the far half mirrored the bare sky as a milky sheet: the bright end of the picture is pressed down, the tint is the Pond's green-brown
             ${RIP ? 'mc = mix(vec3(dot(mc, vec3(0.3, 0.6, 0.1))), mc, 0.72);      // handoff-8 (critic r3: "too yellow-lime"; the photographs: a darker, browner green): the mirrored lawn and leaves lose some colour and the tint below is browner and darker (was 0.62, 0.61, 0.47)' : ''}
             totalEmissiveRadiance += mc * ${OLD ? 'vec3(0.27, 0.27, 0.16)' : RIP ? 'vec3(0.50, 0.475, 0.37)' : 'vec3(0.62, 0.61, 0.47)'} * fres * (1.0 - lf);${OLD ? '' : ' pkSpec = 0.0;'} }
           ${OLD ? '' : 'else { float cv = clamp(normalize(cameraPosition - vWPos).y, 0.0, 1.0); pkSpec = mix(0.05, 0.42, smoothstep(0.05, 0.26, cv + (mur - 0.5) * 0.08)) * (1.0 - lf); }'}`,
    nbody: `{ vec2 q = vWPos.xz * 2.3; float t = uTime * 0.25;
              vec2 r = vec2(vnoise(q + vec2(t, 0.3 * t)) - vnoise(q + vec2(0.35 - t * 0.6, 1.7)), vnoise(q * 1.7 + vec2(4.0, t)) - vnoise(q * 1.7 + vec2(1.3, 9.0 - t))) * 0.011;
              normal = normalize(normal + (viewMatrix * vec4(r.x, 0.0, r.y, 0.0)).xyz); }` });
  return MAT;
}
export const inCorr = (x, y, C) => { for (const d of C) { const L = Math.hypot(d.bx - d.ax, d.by - d.ay) || 1, ux = (d.bx - d.ax) / L, uy = (d.by - d.ay) / L, s = (x - d.ax) * ux + (y - d.ay) * uy, o = -(x - d.ax) * uy + (y - d.ay) * ux; if (s > -0.5 && s < L + 0.5 && Math.abs(o) < d.hw + 0.3) return true; } return false; };

// build(game, area, corridors) -> { group }   collision goes to game.statics under whatever owner the caller has set
export function build(game, a, corridors = []) {
  const group = new THREE.Group(); group.name = 'park_water:' + (a.name || a.id || '');
  const V = (r) => r.map((p) => new THREE.Vector2(p[0], p[1])); const shape = new THREE.Shape(V(a.ring)); for (const h of a.holes || []) shape.holes.push(new THREE.Path(V(h)));
  const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);      // (x, y) -> (x, 0, -y), facing up
  let level = a.level; if (level == null || !isFinite(level)) { const hs = a.ring.map((p) => game.terrain.ground(p[0], p[1])).filter((v) => isFinite(v)).sort((x, y) => x - y); level = hs.length ? hs[Math.floor(hs.length * 0.25)] - 0.1 : 0; }      /* no level in the data: the low quarter of the ground along the outline */
  const mesh = new THREE.Mesh(geo, material(game)); mesh.position.y = BASE + level - 0.05; mesh.receiveShadow = !!mesh.material.userData.old;      /* a mirror takes no cast shadows */ mesh.name = 'park_water'; group.add(mesh);
  if (MIR) { const lv = mesh.position.y; let cx = 0, cy = 0; for (const p of a.ring) { cx += p[0] / a.ring.length; cy += p[1] / a.ring.length; } MIR.meshes.add(mesh);      /* one mirror plane: that of the water sheet in view whose middle is nearest the camera */
    let rr = 0; for (const p of a.ring) rr = Math.max(rr, Math.hypot(p[0] - cx, p[1] - cy)); const MD = game.P && game.P.has('parkmirrord') ? +game.P.get('parkmirrord') : 60;      /* Nov 16: the mirror's extra scene draw cost 6 fps at the Grand Army Plaza corner (M1 Pro, 38 v 43.5 with ?park=0; 44.5 with ?parkmirror=0) where the Pond lies hidden behind the wall: now only within MD metres of the sheet's reach (?parkmirrord=) */
    mesh.userData.mir = { cx, cy, rr, MD, lv };      /* lead lake-helifire: what the mirror's own look before each frame needs (mirror()) */
    if (!MIR.sync) mesh.onBeforeRender = (r, sc, cam) => { const now = performance.now(), d = Math.hypot(cam.position.x - cx, -cam.position.z - cy); if (d - rr > MD) return; if (now - MIR.seen > 300 || d <= MIR.dist + 1 || MIR.who === mesh) { MIR.who = mesh; MIR.dist = d; MIR.level = lv; MIR.seen = now; } }; mesh.addEventListener('removed', () => MIR.meshes.delete(mesh)); }
  const st = game.statics; let segs = 0;
  for (const r of [a.ring].concat(a.holes || [])) for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 1.5));
    for (let k = 0; k < n; k++) { const ax = p[0] + (q[0] - p[0]) * k / n, ay = p[1] + (q[1] - p[1]) * k / n, bx = p[0] + (q[0] - p[0]) * (k + 1) / n, by = p[1] + (q[1] - p[1]) * (k + 1) / n;
      if (corridors.length && inCorr((ax + bx) / 2, (ay + by) / 2, corridors)) continue; st.addSeg(ax, ay, bx, by, 0.4, 'water'); segs++; } }
  return { group, level, segs };
}

// mirrorNow(): the mirror picture for the camera as it stands now (a still tool draws frames by hand, outside the frame callbacks)
export function mirrorNow() { if (MIR && MIR.sync) return { draws: MIR.draws, ms: +MIR.ms.toFixed(1), on: MIR.U.uMirOn.value, level: MIR.level, err: MIR.err, sync: true };      /* drawn with every frame now: nothing to do by hand */ if (MIR && !MIR.err && performance.now() - MIR.seen < 5000) { MIR.once(); return { draws: MIR.draws, ms: +MIR.ms.toFixed(1), on: MIR.U.uMirOn.value, level: MIR.level, err: MIR.err }; } return MIR ? { err: MIR.err, seen: false } : null; }
