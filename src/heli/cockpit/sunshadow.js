// sunshadow.js: the cabin's own sun shadow. The game's one sun shadow map covers 300 m at about 7 cm a texel: right for streets,
// far too coarse for the edge of a glareshield across a dial. This draws the aircraft alone (depth only, 1024 x 1024, 4.6 m across,
// about 4.5 mm a texel) from the sun, and the cockpit's materials read it: crisp patches of sun through the windows, the hood's
// shadow over the panel, a bezel's shadow on its own face. Drawn only while the camera is in or near the cabin.
import * as THREE from 'three';

export class CabinSun {
  constructor(size = 1024, half = 2.3) {
    this.size = size; this.half = half;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
    this.rt.depthTexture = new THREE.DepthTexture(size, size, THREE.UnsignedIntType); this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.LinearFilter; this.rt.depthTexture.compareFunction = THREE.LessEqualCompare;
    this.cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.5, 14.5); this.cam.layers.enableAll();      // the aircraft lives on a layer of its own (model.js), the cabin on the same one
    this.scene = new THREE.Scene(); this.scene.matrixWorldAutoUpdate = false;
    this.scene.overrideMaterial = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide }); this.scene.overrideMaterial.colorWrite = false;
    this.u = { tCabSh: { value: this.rt.depthTexture }, uCabShM: { value: new THREE.Matrix4() }, uCabShOn: { value: 0 }, uCabShPx: { value: 1 / size }, uCabScene: { value: 1 } };      // uCabScene: how much of the sun the city lets through to the aircraft (0 in a building's shadow)
    this._bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1); this._hid = []; this._skip = null; this._rw = new THREE.Matrix4(); this._obj = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._sb = new THREE.Vector3(); this._last = new THREE.Vector3(0, -1, 0); this._age = 99;
    this._hide = (o) => { if (o.isMesh && o.visible && ((o.material && o.material.transparent) || (this._skip && this._skip.includes(o)))) { o.visible = false; this._hid.push(o); } };
  }
  // root: the aircraft's root group (shell + cockpit); center: Vector3 (world); sunDir: unit vector toward the sun (world); skip: objects never to draw
  render(renderer, root, center, sunDir, skip) {
    if (!(sunDir.y > 0.05)) { this.u.uCabShOn.value = 0; return; }
    // The map is kept in the AIRCRAFT's frame: while the sun stands where it stood as the airframe sees it (within 0.7 degrees) the
    // last picture is still right and only its matrix is carried along; it is redrawn when the aircraft has turned under the sun,
    // and at least every 45th frame for the parts that move inside (sticks, the door).
    this._rw.compose(root.position, root.quaternion, root.scale); this._q.copy(root.quaternion).invert(); this._sb.copy(sunDir).applyQuaternion(this._q);
    if (this.u.uCabShOn.value > 0.5 && this._age < 45 && this._sb.dot(this._last) > 0.99993) { this._age++; this.u.uCabShM.value.copy(this._obj).multiply(this._rw.invert()); return; }
    this._age = 0; this._last.copy(this._sb);
    const cam = this.cam; cam.position.copy(center).addScaledVector(sunDir, 7.5); cam.up.set(0, 1, 0); cam.lookAt(center); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    this.u.uCabShM.value.multiplyMatrices(this._bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse); this._obj.copy(this.u.uCabShM.value).multiply(this._rw);
    root.updateMatrixWorld(true);
    // glass and the rotor's blur let the sun through; needle quads are cut-outs the depth pass cannot see
    const hid = this._hid; hid.length = 0; this._skip = skip; root.traverse(this._hide);
    const old = renderer.getRenderTarget(), au = renderer.shadowMap.autoUpdate, ac = renderer.autoClear, xr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false; renderer.autoClear = true;
    this.scene.children.length = 0; this.scene.children.push(root);      // drawn as is, without leaving its place in the game's scene
    renderer.setRenderTarget(this.rt); renderer.render(this.scene, cam); renderer.setRenderTarget(old);
    this.scene.children.length = 0; renderer.shadowMap.autoUpdate = au; renderer.xr.enabled = xr; renderer.autoClear = ac;
    for (const o of hid) o.visible = true;
    this.u.uCabShOn.value = 1;
  }
  // The map must exist on the GPU before any material that reads it is drawn: a compared-depth sampler on a texture never rendered to
  // makes the driver refuse the whole draw (the cabin then vanished from outside until the first time an eye came near it).
  prime(renderer) { const old = renderer.getRenderTarget(); renderer.setRenderTarget(this.rt); renderer.clear(true, true, false); renderer.setRenderTarget(old); }
  off() { this.u.uCabShOn.value = 0; this._age = 99; }
  // GLSL the materials share
  get vertPars() { return 'uniform mat4 uCabShM; varying vec3 vCabSh;'; }
  // after begin_vertex (and skinning): `transformed` is the object-space position
  get vertMain() { return `{ vec4 cw = vec4(transformed, 1.0); vec3 cn = objectNormal;
      #ifdef USE_INSTANCING
        cw = instanceMatrix * cw; cn = mat3(instanceMatrix) * cn;
      #endif
      cw = modelMatrix * cw; cw.xyz += normalize(mat3(modelMatrix) * cn) * 0.0035; vCabSh = (uCabShM * cw).xyz; }`; }
  get fragPars() { return `uniform highp sampler2DShadow tCabSh; uniform float uCabShOn; uniform float uCabShPx; uniform float uCabScene; varying vec3 vCabSh;
    // five hardware-compared taps (each already a blend of four texels) on a tilted cross: a soft edge with no steps
    float cabSun() { if (uCabShOn < 0.5) return uCabScene; vec3 c = vCabSh; if (c.x < 0.01 || c.x > 0.99 || c.y < 0.01 || c.y > 0.99 || c.z > 0.999) return uCabScene;
      float z = c.z - 0.00016; vec2 a = vec2(1.45, 0.55) * uCabShPx, b = vec2(-0.55, 1.45) * uCabShPx;
      float s = texture(tCabSh, vec3(c.xy, z)) * 0.28 + (texture(tCabSh, vec3(c.xy + a, z)) + texture(tCabSh, vec3(c.xy - a, z)) + texture(tCabSh, vec3(c.xy + b, z)) + texture(tCabSh, vec3(c.xy - b, z))) * 0.18;
      return s * uCabScene; }
    float cabSun1() { if (uCabShOn < 0.5) return uCabScene; vec3 c = vCabSh; if (c.x < 0.01 || c.x > 0.99 || c.y < 0.01 || c.y > 0.99 || c.z > 0.999) return uCabScene; return texture(tCabSh, vec3(c.xy, c.z - 0.00016)) * uCabScene; }`; }
  // give a plain three.js material the cabin's sun shadow (its direct light is cut where the aircraft shades it)
  patch(m) {
    const prev = m.onBeforeCompile, self = this;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      Object.assign(sh.uniforms, self.u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + self.vertPars).replace('#include <project_vertex>', self.vertMain + '\n#include <project_vertex>');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + self.fragPars);
      if (!sh.fragmentShader.includes('cabSun()')) sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float cs = cabSun(); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs; }');
    };
    return m;
  }
}
