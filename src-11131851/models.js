// models.js: the Blender model kit (assets/models.glb) turned into instanced batches for cars and street props, and clones for people.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

export const CAR_TYPES = ['sedan', 'taxi', 'suv', 'van', 'sport', 'bus'];
export const PAINTS = [0x0d0d0f, 0x1a1c20, 0xd8d9d6, 0xeeeeea, 0x8f9499, 0x5b6068, 0x2a3442, 0x13294b, 0x6b1414, 0x7a1f1f, 0x2e3d2f, 0xb8b2a2, 0x3b2a1e, 0x9aa3ad, 0xc9ccd1, 0x202428];

function meshesOf(root, skip) {
  const out = []; root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh) return; let p = o; while (p && p !== root) { if (skip && skip(p)) return; p = p.parent; }
    out.push({ geometry: o.geometry, material: o.material, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld) });
  });
  return out;
}

export class Kit {
  async load() {
    const gltf = await new GLTFLoader().loadAsync('assets/models.glb');
    this.gltf = gltf; this.root = gltf.scene; this.animations = gltf.animations;
    this.root.traverse((o) => {
      if (!o.isMesh) return; const m = o.material; o.castShadow = true; o.receiveShadow = true;
      if (m.name === 'glass' || m.name === 'glass_dark') { m.transparent = false; m.opacity = 1; m.roughness = 0.04; m.metalness = 0.0; m.color.setRGB(0.012, 0.016, 0.018); m.envMapIntensity = 1.6; }
      if (m.name === 'paint') { m.roughness = 0.22; m.metalness = 0.55; }
      if (m.name && m.name.startsWith('leaves')) { m.alphaTest = 0.45; m.transparent = false; m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; }
      if (/^sig_(red|yellow|green)$/.test(m.name) && !m.userData.dimmed) { m.color.multiplyScalar(0.16); m.roughness = 0.2; m.userData.dimmed = true; }   // an unlit lens is dark glass; the lit one is drawn over it (game.js)
      if (m.name === 'lamp') { m.emissiveIntensity = 0; m.color.setRGB(0.75, 0.75, 0.72); m.roughness = 0.35; }   // street lamps are off in daylight
      if (m.map) m.map.anisotropy = 8;
    });
    this.cars = {};
    for (const t of CAR_TYPES) {
      const n = this.root.getObjectByName('car_' + t); if (!n) continue;
      const wheels = n.children.filter((o) => /^wheel_/.test(o.name));    // the wheel nodes themselves: the loader names their part meshes wheel_*_1.. too, and those are not wheels
      const body = meshesOf(n, (o) => /^wheel_/.test(o.name));
      const box = new THREE.Box3(); for (const b of body) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox.clone().applyMatrix4(b.matrix)); }
      const wp = wheels.map((w) => ({ name: w.name, pos: w.position.clone(), parts: meshesOf(w), front: /^wheel_f/.test(w.name), left: w.position.z < 0 }));
      this.cars[t] = { type: t, body, wheels: wp, len: box.max.x - box.min.x, wid: box.max.z - box.min.z, hgt: box.max.y, radius: wp.length ? wp[0].pos.y : 0.34, wheelbase: wp.length ? Math.abs(wp[0].pos.x - wp[2].pos.x) : 2.8 };
    }
    this.props = {};
    this.root.traverse((o) => { if (/^prop_/.test(o.name) && o.parent === this.root) this.props[o.name.slice(5)] = meshesOf(o); });
    this.people = {}; this.peopleAnims = this.animations;
    for (const n of ['player', 'ped_a', 'ped_b', 'ped_c', 'ped_d']) { const o = this.root.getObjectByName(n); if (o) this.people[n] = o; }
    // ground speed of each clip at playback rate 1 (m/s): feet stay planted when rate = speed / this
    this.clipSpeed = { walk: 1.45, walk2: 1.45, walk3: 1.45, run: 5.0 };
    await this.loadPeople();
  }
  // The people agent's finished characters (people/export, copied to assets/people by tools/sync.sh) replace the kit's own figures when
  // they are there: same contract (one node per character, bones <name>_<bone>, clips carrying every character's tracks), more clips
  // (Walk2, Walk3, TurnL, TurnR, GetIn, GetOut) and real mocap. people.json, if present, carries ground speeds and seat data.
  async loadPeople() {
    const A = 'assets/people/'; let meta = null;
    try { const r = await fetch(A + 'people.json', { cache: 'no-store' }); if (r.ok) meta = await r.json(); } catch (e) {}
    const file = (meta && meta.file) || 'people.glb';
    try { const h = await fetch(A + file, { method: 'HEAD', cache: 'no-store' }); if (!h.ok) return; } catch (e) { return; }
    let gltf; try { gltf = await new GLTFLoader().loadAsync(A + file); } catch (e) { console.log('[game] people export not loaded: ' + (e && e.message)); return; }
    const found = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (m.map) m.map.anisotropy = 8; if (/^eyes_/.test(m.name || '') && m.map && m.map.image && !m.userData.eyeFix) {   // three of the export's eye textures carry a pale blue disc where the pupil's patch should be black, so those people had glowing eyes: paint it out
        m.userData.eyeFix = true; m.roughness = 0.35; m.envMapIntensity = 0.4; m.color.multiplyScalar(0.8);
        try { const im = m.map.image, c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); g.fillStyle = '#000'; g.beginPath(); g.arc(c.width * 0.93, c.height * 0.93, c.width * 0.085, 0, 7); g.fill();
          const t = new THREE.CanvasTexture(c); t.flipY = m.map.flipY; t.colorSpace = m.map.colorSpace; t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; t.channel = m.map.channel; m.map = t; } catch (e) {}
      }
      if (/^(hair|brows|lashes)_/.test(m.name || '')) { m.transparent = false; m.alphaTest = 0.35; m.depthWrite = true; m.side = THREE.DoubleSide; } } } });   // hair, brows and lashes are alpha-tested cards (README)
    for (const o of gltf.scene.children) { let skinned = false; o.traverse((c) => { if (c.isSkinnedMesh) skinned = true; }); if (skinned && o.name) found[o.name] = o; }
    if (!Object.keys(found).length) { console.log('[game] people export has no skinned characters'); return; }
    this.people = found; this.peopleAnims = gltf.animations; this.peopleMeta = meta || {}; this.peopleExport = true;
    // natural ground speeds of the mocap clips for a 1.78 m person (people/export/README.md); each character's are scaled by its height
    Object.assign(this.clipSpeed, { walk: 1.36, walk2: 1.59, walk3: 1.28, walk4: 1.42, walkslow: 0.92, walkbrisk: 1.91, jog: 2.62, run: 4.02 });
    if (meta && meta.speeds) for (const k in meta.speeds) this.clipSpeed[k.toLowerCase()] = meta.speeds[k];
    this.tall = {}; this.driveHips = {};
    for (const n in found) { const box = new THREE.Box3().setFromObject(found[n]); this.tall[n] = box.max.y > 1.2 && box.max.y < 2.3 ? box.max.y / 1.78 : 1;
      try { const p = this.person(n); if (p && p.acts.drive) { p.acts.drive.play(); p.mixer.setTime(0); p.object.updateMatrixWorld(true); const h = p.object.getObjectByName(n + '_hips'); if (h) this.driveHips[n] = h.getWorldPosition(new THREE.Vector3()).y; } } catch (e) {} }
    if (meta && meta.seats) this.seats = meta.seats;
    console.log('[game] people export: ' + Object.keys(found).join(', ') + '; clips ' + gltf.animations.map((a) => a.name).join(', '));
  }
  pedKinds() { const k = Object.keys(this.people).filter((n) => n !== 'player'); return k.length ? k : ['ped_a', 'ped_b', 'ped_c', 'ped_d']; }
  // a skinned person (own skeleton + mixer), or null when the kit has none yet
  person(name) {
    const src = this.people[name]; if (!src) return null;
    const o = SkeletonUtils.clone(src); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0);
    // lead: the clone gives each of a character's seven skinned parts its own copy of the skeleton, and three.js uploads every skeleton it
    // draws every frame (44 pedestrians were 308 uploads). All parts share the character's one skin, so bind them to one skeleton; and give
    // each part a generous bounding sphere so people outside the view are culled (unculled, every pedestrian was skinned and drawn always).
    { let skel = null; const parts = []; o.traverse((c) => { if (c.isSkinnedMesh) parts.push(c); });
      for (const c of parts) { if (!skel) skel = c.skeleton; else if (c.skeleton.bones.length === skel.bones.length && c.skeleton.bones.every((b, i) => b.name === skel.bones[i].name)) c.bind(skel, c.bindMatrix); }
      o.updateMatrixWorld(true);
      for (const c of parts) { c.castShadow = true; try { c.computeBoundingSphere(); c.boundingSphere.radius = c.boundingSphere.radius * 1.6 + 0.9; c.frustumCulled = true; } catch (e) { c.frustumCulled = false; } } }
    o.traverse((c) => { if (c.isMesh && !c.isSkinnedMesh) { c.castShadow = true; c.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(o), acts = {}, dur = {};
    for (const a of this.peopleAnims) {     // each clip carries every character's tracks, prefixed with the character name: keep ours
      let tracks = a.tracks.filter((t) => t.name.startsWith(name + '_') || t.name.startsWith(name + '.'));
      if (!tracks.length && !a.tracks.some((t) => /^(player|ped_[a-z0-9]+)[_.]/.test(t.name))) tracks = a.tracks;     // a shared skeleton: one clip fits everyone
      if (!tracks.length) continue; const key = a.name.toLowerCase(); if (acts[key]) continue;
      acts[key] = mixer.clipAction(new THREE.AnimationClip(a.name + '_' + name, a.duration, tracks)); dur[key] = a.duration;
      if (key === 'getin' || key === 'getout' || key === 'turnl' || key === 'turnr') { acts[key].setLoop(THREE.LoopOnce, 1); acts[key].clampWhenFinished = true; }
    }
    // the walk clips this character has, with the ground speed each one covers at rate 1
    const k = (this.tall && this.tall[name]) || 1, walks = []; for (const w of ['walk', 'walk2', 'walk3', 'walk4', 'walkslow', 'walkbrisk']) if (acts[w]) walks.push({ name: w, speed: (this.clipSpeed[w] || 1.45) * k });
    return { object: o, mixer, acts, dur, cur: null, walks, runSpeed: (this.clipSpeed.run || 5) * k, name };
  }
}

// A person frozen in one frame of a clip, as plain geometry: the drivers of the traffic are instances of these.
export function bakeFigure(kit, name, clip, time = 0.2) {
  const p = kit.person(name); if (!p || !p.acts[clip]) return null;
  p.acts[clip].play(); p.mixer.setTime(time); p.object.updateMatrixWorld(true);
  const parts = [], v = new THREE.Vector3();
  p.object.traverse((m) => {
    if (!m.isSkinnedMesh) return; m.skeleton.update();
    const g = m.geometry.clone(), pos = g.attributes.position, arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z; }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight'); g.morphAttributes = {}; g.computeVertexNormals(); g.computeBoundingSphere();
    parts.push({ geometry: g, material: m.material });
  });
  return parts.length ? parts : null;
}
export class FigureBatch {
  constructor(scene, parts, cap) { this.cap = cap; this.n = 0; this.meshes = parts.map((p) => { const im = new THREE.InstancedMesh(p.geometry, p.material, cap); im.frustumCulled = false; im.castShadow = false; im.count = 0; scene.add(im); return im; }); }
  begin() { this.n = 0; }
  add(x, y, z, h) { if (this.n >= this.cap) return; _e.set(0, h, 0); _q.setFromEuler(_e); _v.set(x, z, -y); _s.set(1, 1, 1); _m.compose(_v, _q, _s); for (const im of this.meshes) im.setMatrixAt(this.n, _m); this.n++; }
  end() { for (const im of this.meshes) { im.count = this.n; im.instanceMatrix.needsUpdate = true; } }
}

let _underMat = null;
function underCarMat() {
  if (_underMat) return _underMat;
  { let ok = false; try { ok = !!document.createElement('canvas').getContext('2d').createImageData(1, 1).data; } catch (e) {} if (!ok) return (_underMat = new THREE.MeshBasicMaterial({ visible: false })); }   // headless sim (tools/sim.mjs) has no real canvas
  const S = 128, c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d'), d = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // distance outside a rounded box that is the car's footprint (the plane is 1.3 x the footprint), in footprint half-widths
    const u = Math.abs((x + 0.5) / S - 0.5) * 2 * 1.3, v = Math.abs((y + 0.5) / S - 0.5) * 2 * 1.3;
    const dx = Math.max(u - 0.86, 0), dy = Math.max(v - 0.80, 0), out = Math.hypot(dx, dy), inside = Math.min(1, Math.min(1 - u, 1 - v) / 0.5);
    let k = out <= 0 ? 1 : Math.exp(-out * out / (2 * 0.085 * 0.085));
    k *= 0.80 + 0.14 * Math.max(0, inside);                    // darkest in the middle, a little light creeping in at the sills
    const t = Math.round(255 * (1 - k)); const o = (y * S + x) * 4; d.data[o] = t; d.data[o + 1] = t; d.data[o + 2] = Math.min(255, t + 4); d.data[o + 3] = 255;
  }
  g.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  _underMat = new THREE.MeshBasicMaterial({ map: t, blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, toneMapped: false });
  return _underMat;
}
function underCarGeo(len, wid) { const g = new THREE.PlaneGeometry(len * 1.3, wid * 1.3); g.rotateX(-Math.PI / 2); return g; }

// One instanced batch per car type: body parts, and the four wheels as their own instances so they can spin and steer.
export class CarBatch {
  constructor(scene, def, cap) {
    this.def = def; this.cap = cap; this.n = 0; this.meshes = []; this.wheelMeshes = [];
    for (const b of def.body) {
      const im = new THREE.InstancedMesh(b.geometry, b.material, cap); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.count = 0;
      im.userData.local = b.matrix; im.userData.paint = b.material.name === 'paint';
      if (im.userData.paint) { im.material = b.material.clone(); im.material.color.set(0xffffff); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); }
      // tail lamps: the instance colour carries the brake state (1 = off, 2 = braking), which also lights the lens
      if (b.material.name === 'light_tail') { im.userData.tail = true; im.material = b.material.clone(); im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        im.material.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  { float brk = clamp(vColor.r - 1.0, 0.0, 1.0); diffuseColor.rgb /= max(vColor.r, 1.0); totalEmissiveRadiance = totalEmissiveRadiance * mix(0.06, 1.0, brk) + vec3(6.0, 0.14, 0.05) * brk; }\n#endif'); }; im.material.customProgramCacheKey = () => 'tail-brake'; }
      scene.add(im); this.meshes.push(im);
    }
    // LIGHT lane: the sky a car hides from the road under it. Real light, not a trick: under a body 20 cm off the ground almost no sky
    // reaches the asphalt, in sun or in shade, so every car sits on a near-black core that fades out past its sills.
    { const im = new THREE.InstancedMesh(underCarGeo(def.len || 4.8, def.wid || 2.0), underCarMat(), cap); im.frustumCulled = false; im.count = 0; im.renderOrder = 3; scene.add(im); this.under = im; }
    // all four wheels share the first wheel's geometry set (mirrored by a half turn on the other side)
    const w0 = def.wheels[0];
    if (w0) for (const p of w0.parts) {
      const im = new THREE.InstancedMesh(p.geometry, p.material, cap * 4); im.castShadow = true; im.frustumCulled = false; im.count = 0; im.userData.local = p.matrix; scene.add(im); this.wheelMeshes.push(im);
    }
  }
  begin() { this.n = 0; }
  // x, y map metres; z height; h heading; roll/pitch radians; spin wheel angle; steer front wheel angle
  add(x, y, z, h, roll, pitch, color, spin, steer, brake) {
    const i = this.n++; if (i >= this.cap) { this.n = this.cap; return; }
    _e.set(roll, h, pitch, 'YZX'); _q.setFromEuler(_e); _v.set(x, z, -y); _m.compose(_v, _q, _s);
    for (const im of this.meshes) {
      _m2.multiplyMatrices(_m, im.userData.local); im.setMatrixAt(i, _m2);
      if (im.userData.paint) { _c.set(color); im.instanceColor.setXYZ(i, _c.r, _c.g, _c.b); }
      else if (im.userData.tail) { const k = brake ? 2 : 1; im.instanceColor.setXYZ(i, k, k, k); }
    }
    _e.set(0, h, 0); _q.setFromEuler(_e); _v.set(x, z + 0.035, -y); _m2.compose(_v, _q, _s); this.under.setMatrixAt(i, _m2);
    const ws = this.def.wheels, w0 = ws[0];
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k]; const flip = w.left !== w0.left;
      _e.set(0, (w.front ? steer : 0) + (flip ? Math.PI : 0), flip ? spin : -spin, 'YZX'); _q.setFromEuler(_e);
      _m2.compose(w.pos, _q, _s); _m2.premultiply(_m);
      for (const im of this.wheelMeshes) { const mm = new THREE.Matrix4().multiplyMatrices(_m2, im.userData.local); im.setMatrixAt(i * 4 + k, mm); }
    }
  }
  end() {
    for (const im of this.meshes) { im.count = this.n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    for (const im of this.wheelMeshes) { im.count = this.n * 4; im.instanceMatrix.needsUpdate = true; }
    this.under.count = this.n; this.under.instanceMatrix.needsUpdate = true;
  }
}

// Static street furniture, instanced per kind and split into tiles so far tiles are culled.
export function addProps(scene, kit, city, extra = {}) {
  const groups = [];
  const all = Object.assign({}, city.props, extra);
  for (const kind of Object.keys(all)) {
    const parts = kit.props[kind]; const list = all[kind]; if (!parts || !list.length) continue;
    const T = 190, tiles = new Map();
    for (const p of list) { const k = Math.floor(p[0] / T) + ',' + Math.floor(p[1] / T); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(p); }
    for (const [, items] of tiles) {
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        im.castShadow = !['ac', 'bin', 'hydrant', 'newsbox', 'meter', 'cone'].includes(kind); im.receiveShadow = true;   // small kerb things cost a shadow-pass draw each for a shadow nobody sees
        items.forEach((p, i) => {
          _e.set(0, p[2] + (p[6] || 0), 0); _q.setFromEuler(_e); _v.set(p[0], p[4] === undefined || kind === 'signal' ? (p[7] || 0.15) : p[4], -p[1]); _s.setScalar(p[3] || 1);
          _m.compose(_v, _q, _s); _m2.multiplyMatrices(_m, part.matrix); im.setMatrixAt(i, _m2);
        });
        _s.set(1, 1, 1); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.matrixAutoUpdate = false; im.userData.kind = kind; im.userData.items = items;
        scene.add(im); groups.push(im);
      }
    }
  }
  return groups;
}
