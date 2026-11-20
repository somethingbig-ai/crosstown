// models2.js (merge2 lane, Nov 16): the Aurora lanes' Blender vehicles (lanes/aucars, lanes/autrucks) as kinds of streets/vehicles_next.js.
// Each model is two GLBs (near, far) in assets/streets/vehicles/models2/. They are given to vehicles_next.js under its own conventions:
// nodes veh_<kind>_l0 (near body), _l1 and _l2 (far), vwheel_<kind> (one wheel), and a meta entry per kind (sizes, axles, what it stands in for).
//   au_sedan    a livery sedan: one more kind of 'sedan'           au_suv   a long black livery SUV: one more kind of 'suv'
//   au_police   a patrol utility, parked at the kerb now and then  au_ambulance  a box ambulance, rare, kerb and traffic
//   au_tiller   a ladder truck, avenue kerbs only, rarest
// au_police and au_ambulance are built in but off (Nov 16: they did not pass the stills gate; their GLBs are not shipped): name them in ?models2= to see them once the files are there.
// OFF: ?models2=0 (nothing fetched, every car as before). ?models2=au_sedan,au_suv = only those kinds. Public build: off unless ?models2=1.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// near/far: the two GLBs in assets/streets/vehicles/models2/. wheels 'spin': the near GLB has wheel_FL/FR/RL/RR nodes beside the body (one wheel is
// drawn four times, turning and steering, as the kit's are); 'static': the wheels stay part of the body. color: one fixed paint (else the
// kind is painted like the kind it stands in for). move = [avenue, street] weight in traffic, park = [street, avenue] weight at the kerb.
// wid is the body without mirrors (a parked row is spaced by it).
export const KINDS = {
  au_sedan: { near: 'black-sedan-game', far: 'black-sedan-far', wheels: 'spin', len: 4.88, wid: 1.84, hgt: 1.44, radius: 0.329, ax_f: 1.412, ax_r: -1.412, ywl: 0.785, tw: 0.2, seat: [-0.1, 0.37, 0.06], base: ['sedan'], cls: 'car', tris: { 0: 134512, 1: 21567, 2: 21567 } },
  au_suv: { near: 'black-suv-game', far: 'black-suv-far', wheels: 'spin', len: 5.65, wid: 2.0, hgt: 1.92, radius: 0.401, ax_f: 1.651, ax_r: -1.651, ywl: 0.871, tw: 0.26, seat: [0.0, 0.39, 0.25], base: ['suv'], cls: 'suv', tris: { 0: 145964, 1: 27792, 2: 27792 } },
  au_police: { off: true, near: 'police-utility-game', far: 'police-utility-far', wheels: 'spin', len: 5.1, wid: 2.0, hgt: 1.85, radius: 0.382, ax_f: 1.513, ax_r: -1.513, ywl: 0.87, tw: 0.26, seat: [0.0, 0.39, 0.25], base: [], cls: 'suv', color: 0xe6e9ec, park: [0.35, 0.5], tris: { 0: 121752, 1: 35402, 2: 35402 } },
  au_ambulance: { off: true, near: 'ambulance-game', far: 'ambulance-far', wheels: 'static', len: 6.94, wid: 2.44, hgt: 2.72, radius: 0.391, ax_f: 2.007, ax_r: -2.007, ywl: 0.99, tw: 0.3, seat: [1.6, 0.5, 0.6], base: [], cls: 'van', color: 0xe9ecee, park: [0.2, 0.3], move: [0.3, 0.3], tris: { 0: 20246, 1: 20246, 2: 1694 } },
  au_tiller: { near: 'tiller', far: 'tiller-far', wheels: 'static', len: 16.79, wid: 2.6, hgt: 3.75, radius: 0.53, ax_f: 6.94, ax_r: -6.63, ywl: 1.085, tw: 0.28, seat: [7.2, 0.6, 1.0], base: [], cls: 'truck', park: [0, 0.2], tris: { 0: 20000, 1: 20000, 2: 1808 } },
};

export function wanted(game) {
  const P = game.P, v = P && P.has('models2') ? P.get('models2') : null;
  if (v === '0') return [];
  const all = Object.keys(KINDS); if (v === null || v === '1' || v === '') return all.filter((k) => !KINDS[k].off);      // off: built in, not shown unless named (did not pass the stills gate; see lanes/merge2/models-1/README.md)
  return all.filter((k) => v.split(',').includes(k));
}

// A: the vehicles asset folder (…/streets/vehicles/); draco: the caller's DRACOLoader (the trucks are Draco GLBs); oxMeta: the openx kinds
// (changed in place: the openx cab is no longer cast as a taxi while one of ours is). Returns null when off or when nothing loaded.
export async function load(game, A, draco, oxMeta) {
  const kinds = wanted(game); if (!kinds.length) return null;
  const loader = new GLTFLoader().setDRACOLoader(draco), meta = {}, nodes = {}, failed = [];
  const KIT = /^(paint|glass|glass_dark|tire|plate|lens|light_tail|light_head|amber|drl|chrome|rim)$/;
  const prep = (node, name, wheelsOut) => {
    node.name = name; node.updateMatrixWorld(true);
    node.traverse((o) => { if (!o.isMesh) return;
      const m = (o.material = o.material.clone()), n = m.name || '';
      if (o.geometry.attributes.color && !/glass/i.test(n) && n !== 'tire') { o.userData.m2vc = true; m.name = 'm2_body'; }      // colour per vertex (the trucks): kept, not repainted per car
      else if (!KIT.test(n) && !/^interior|^x_|^brake|^lamp|^gap/.test(n) && (m.transparent || /glass|glaz/i.test(n))) m.name = 'glass_dark';
    });
    return node;
  };
  await Promise.all(kinds.map(async (k) => { const K = KINDS[k];
    try { const [g, f] = await Promise.all([loader.loadAsync(A + 'models2/' + K.near + '.glb'), loader.loadAsync(A + 'models2/' + K.far + '.glb')]);
      g.scene.updateMatrixWorld(true); let near = g.scene;
      if (K.wheels === 'spin') {      // the body without its wheels, and one wheel (front left: unturned) standing at the origin with its own size kept
        const ws = g.scene.children.filter((o) => /^wheel_/.test(o.name)), fl = ws.find((o) => /FL$/.test(o.name)); if (ws.length !== 4 || !fl) throw new Error('no four wheel nodes');
        near = new THREE.Group(); for (const o of g.scene.children.slice()) if (!ws.includes(o)) near.add(o);
        const wg = new THREE.Group(), w = fl.clone(true); w.position.set(0, 0, 0); w.quaternion.identity(); wg.add(w); nodes['vwheel_' + k] = prep(wg, 'vwheel_' + k);
      }
      const far = prep(f.scene, 'veh_' + k + '_l2');
      nodes['veh_' + k + '_l0'] = prep(near, 'veh_' + k + '_l0'); nodes['veh_' + k + '_l1'] = K.wheels === 'spin' ? far : nodes['veh_' + k + '_l0']; nodes['veh_' + k + '_l2'] = far;
      meta[k] = Object.assign({ m2: true, livery: false, src: 'aurora' }, K); delete meta[k].near; delete meta[k].far;
    } catch (e) { failed.push(k + ': ' + (e && e.message)); } }));
  if (failed.length) console.log('[streets] models2: not loaded: ' + failed.join('; '));
  if (!Object.keys(meta).length) return null;
  console.log('[streets] models2: ' + Object.keys(meta).join(', '));
  return { meta, nodes };
}
