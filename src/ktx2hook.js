// ktx2hook.js (lead, Nov 10): Basis/KTX2 textures. Every GLTFLoader in the game (there are a dozen, in lane files) gets one shared KTX2Loader
// without those files changing: GLTFLoader.prototype.parse is wrapped. Loose textures listed in assets/ktx2.json are swapped for their .ktx2
// file when a TextureLoader asks for them. ?ktx=0 leaves loose textures as they are (models that were converted still need the loader).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
export async function installKTX2(renderer) {
  const k = new KTX2Loader().setTranscoderPath('node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer); k.setWorkerLimit(4);
  const parse = GLTFLoader.prototype.parse; GLTFLoader.prototype.parse = function (...a) { if (!this.ktx2Loader) this.setKTX2Loader(k); return parse.apply(this, a); };
  window.__ktx2 = k;
  if (new URLSearchParams(location.search).get('ktx') === '0') return k;
  let list = {}; try { const r = await fetch('assets/ktx2.json'); if (r.ok) list = await r.json(); } catch (e) {}
  window.__ktx2list = list;
  const norm = (u) => String(u).split('?')[0].replace(/^\.\//, '').replace(/^.*?(assets\/)/, '$1');
  const load = THREE.TextureLoader.prototype.load; THREE.TextureLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const key = norm((this.path || '') + url); if (!list[key]) return load.apply(this, arguments);
    // the caller gets a texture object at once, as with TextureLoader, and sets wrap / colour space / anisotropy on it; the compressed data is filled in when it arrives
    const t = new THREE.CompressedTexture([], 4, 4, THREE.RGBAFormat); t.generateMipmaps = false;
    k.load(key.replace(/\.[a-z]+$/, '.ktx2'), (c) => { t.mipmaps = c.mipmaps; t.image = c.image; t.format = c.format; t.type = c.type; t.minFilter = c.mipmaps.length > 1 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.flipY = false; t.generateMipmaps = false; t.needsUpdate = true; if (onLoad) onLoad(t); }, undefined, (e) => { console.warn('[ktx2] ' + key + ' failed, no fallback: ' + (e && e.message)); if (onError) onError(e); });
    return t; };
  return k;
}
