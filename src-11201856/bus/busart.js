// Install beside look.js and import this module from bus.js (see README).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { makeLook as makeOriginal } from './look.js';
export { DIMS } from './look.js';

export async function makeLook(game, opts = {}) {
  const original = await makeOriginal(game, opts);
  if (game.P?.get('busart') === '0' || game.P?.get('models2') === '0') return original;
  const draco = new DRACOLoader().setDecoderPath('node_modules/three/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const kinds = ['XD40-game', 'XD40-far', 'XD60-game', 'XD60-far'];
  const results = await Promise.allSettled(kinds.map(id => loader.loadAsync('assets/bus/' + id + '.glb')));
  draco.dispose();
  if (results.some(r => r.status === 'rejected')) {
    console.warn('Bus exterior unavailable', results.find(r => r.status === 'rejected').reason);
    for (const r of results) if (r.status === 'fulfilled') r.value.scene.traverse(o => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    return original;
  }
  const cap = opts.cap || 12;
  const group = new THREE.Group();
  group.name = 'Blender bus exteriors';
  const reflectionStrength = {value: 1};
  group.userData.reflectionStrength = reflectionStrength;
  const localReflection = {value:game.world.streetCam ? 1 : 0};
  group.userData.localReflection = localReflection;
  // Kerbside operator lettering above the M15 trailer windows.
  const operatorCanvas=document.createElement('canvas');
  operatorCanvas.width=512; operatorCanvas.height=64;
  const ink=operatorCanvas.getContext('2d');
  ink.fillStyle='#edf0ed';
  ink.fillStyle='#edf0ed'; ink.font='bold 47px sans-serif';
  ink.fillText('CITY BUS',8,49,434);
  const operatorMap=new THREE.CanvasTexture(operatorCanvas);
  operatorMap.colorSpace=THREE.SRGBColorSpace;
  // Match the fleet number already painted on the modeled XD60 nose.
  const fleetCanvas=document.createElement('canvas');
  fleetCanvas.width=512; fleetCanvas.height=256;
  const fleetInk=fleetCanvas.getContext('2d');
  fleetInk.scale(2,2);
  fleetInk.fillStyle='#242528'; fleetInk.font='bold 54px sans-serif';
  fleetInk.textAlign='center'; fleetInk.fillText('6284',64,52,124);
  // Right half of the atlas is the agency plate on the lower hatch.
  fleetInk.save();
  fleetInk.translate(128,0);
  fleetInk.fillStyle='#30282a'; fleetInk.fillRect(2,2,124,12);
  fleetInk.fillStyle='#e0b968'; fleetInk.font='bold 10px serif';
  fleetInk.fillText('NEW YORK',64,12);
  fleetInk.fillStyle='#282527'; fleetInk.font='bold 8px sans-serif';
  fleetInk.font='bold 32px sans-serif'; fleetInk.fillText('6284',88,46,67);
  fleetInk.font='bold 8px sans-serif'; fleetInk.fillText('NEW YORK',64,59);
  fleetInk.restore();
  // Lower atlas row: the two-line bus lane notice on M14 fleet 6144.
  fleetInk.fillStyle='#29282a'; fleetInk.fillRect(0,64,256,64);
  fleetInk.textAlign='left'; fleetInk.font='bold 19px sans-serif';
  fleetInk.fillStyle='#f0eeee'; fleetInk.fillText('BUS LANE',10,103,236);
  const fleetMap=new THREE.CanvasTexture(fleetCanvas);
  fleetMap.colorSpace=THREE.SRGBColorSpace;
  // Plain service lettering on the trailer doors and rear cover.
  const sbsCanvas=document.createElement('canvas');
  sbsCanvas.width=512; sbsCanvas.height=64;
  const sbsInk=sbsCanvas.getContext('2d');
  sbsInk.fillStyle='#edf0ed';
  sbsInk.font='48px sans-serif'; sbsInk.fillText('CITY BUS',8,50);
  const sbsMap=new THREE.CanvasTexture(sbsCanvas);
  sbsMap.colorSpace=THREE.SRGBColorSpace;
  // Match the two service-door outlines and handles in the near Blender mesh.
  const hatchCanvas=document.createElement('canvas');
  hatchCanvas.width=512; hatchCanvas.height=256;
  const hatchInk=hatchCanvas.getContext('2d');
  hatchInk.scale(256,-256); hatchInk.translate(0,-1.34);
  for(const [left,right,top] of [[.16,1.16,1.27],[1.20,1.88,1.20]]) {
    hatchInk.fillStyle='#638e98';
    for(const edge of [left,right]) hatchInk.fillRect(edge,.39,.012,top-.39);
    hatchInk.fillRect(left,top-.012,right-left,.012);
    hatchInk.fillStyle='#526d78';
    hatchInk.fillRect(right-.17,.78,.10,.025);
  }
  const hatchMap=new THREE.CanvasTexture(hatchCanvas);
  hatchMap.colorSpace=THREE.SRGBColorSpace;
  // Radial paint follows the near Blender wheel profile in metres.
  const rimCanvas=document.createElement('canvas');
  rimCanvas.width=512; rimCanvas.height=256;
  const rim=rimCanvas.getContext('2d');
  rim.translate(128,128); rim.scale(256,256);
  function disc(x,y,r,paint) {
    rim.fillStyle=paint;
    rim.beginPath(); rim.arc(x,y,r,0,2*Math.PI); rim.fill();
  }
  // Interpolate the rubber colours between the Blender shoulder rings.
  const rubber=rim.createRadialGradient(0,0,.323,0,0,.49);
  rubber.addColorStop(0,'#2b2c2d');
  rubber.addColorStop((.411-.323)/(.49-.323),'#252628');
  rubber.addColorStop((.465-.323)/(.49-.323),'#303133');
  rubber.addColorStop(1,'#262729');
  disc(0,0,.49,rubber);
  for(const [radius,paint] of [[.311,'#969b9c'],[.292,'#b3b6b4'],[.275,'#686e70'],
                               [.222,'#818786'],[.151,'#737877'],[.124,'#575b5c'],[.097,'#434749']])
    disc(0,0,radius,paint);
  for(let n=0;n<10;n++) {
    const angle=n*Math.PI/5;
    rim.fillStyle='#34383b'; rim.beginPath();
    rim.ellipse(.246*Math.cos(angle),.246*Math.sin(angle),.020,.034,angle,0,2*Math.PI);
    rim.fill();
    disc(.151*Math.cos(angle),.151*Math.sin(angle),.016,'#b1aba0');
  }
  // Second atlas cell follows the pale rim and recessed hub of the M15 trailer.
  rim.setTransform(1,0,0,1,0,0);
  rim.drawImage(rimCanvas,0,0,256,256,256,0,256,256);
  rim.translate(384,128); rim.scale(256,256);
  for(const [radius,paint] of [[.311,'#d5d0bc'],[.292,'#cec9b4'],[.275,'#aaa38e'],
                               [.232,'#8e8776'],[.205,'#484642'],[.143,'#343433'],
                               [.110,'#373836'],[.083,'#303435']])
    disc(0,0,radius,paint);
  for(let n=0;n<10;n++) {
    const angle=n*Math.PI/5;
    rim.fillStyle='#191b1b'; rim.beginPath();
    rim.ellipse(.193*Math.cos(angle),.193*Math.sin(angle),.019,.025,angle,0,2*Math.PI);
    rim.fill();
    disc(.119*Math.cos(angle),.119*Math.sin(angle),.014,'#242727');
  }
  const rimMap=new THREE.CanvasTexture(rimCanvas);
  rimMap.colorSpace=THREE.SRGBColorSpace;
  // Small circular grille immediately aft of the Q39 kerbside front arch.
  const grilleCanvas=document.createElement('canvas');
  grilleCanvas.width=grilleCanvas.height=128;
  const grille=grilleCanvas.getContext('2d');
  for(const [radius,paint] of [[61,'#394044'],[57,'#a6afb1'],[49,'#252b2e']]) {
    grille.fillStyle=paint;
    grille.beginPath(); grille.arc(64,64,radius,0,2*Math.PI); grille.fill();
  }
  grille.clip();
  grille.fillStyle='#677277';
  for(let y=32;y<108;y+=18) grille.fillRect(12,y,104,4);
  const grilleMap=new THREE.CanvasTexture(grilleCanvas);
  grilleMap.colorSpace=THREE.SRGBColorSpace;
  const batches = results.map((r, i) => {
    const parts = [];
    r.value.scene.updateMatrixWorld(true);
    r.value.scene.traverse(source => {
      if (!source.isMesh) return;
      source.geometry.applyMatrix4(source.matrixWorld);
      const mesh = new THREE.InstancedMesh(source.geometry, source.material, cap);
      const art = i >= 2;
      const stop = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      mesh.geometry.setAttribute('busStopPose', stop.setUsage(THREE.DynamicDrawUsage));
      const hasWheels = !mesh.material.transparent;
      if (hasWheels) {
        const angles = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
        mesh.geometry.setAttribute('wheelAngles', angles.setUsage(THREE.DynamicDrawUsage));
      }
      if (art) {
        const bend = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        mesh.geometry.setAttribute('busBend', bend.setUsage(THREE.DynamicDrawUsage));
      }
      const deform = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `
          #include <common>
          attribute vec3 busStopPose;
          ${art ? 'attribute float busBend;' : ''}
          mat2 yawRotation(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
          ${hasWheels ? `
          attribute vec2 wheelAngles;
          vec3 moveWheel(vec3 v, bool point) {
            float frontAxle = ${art ? '6.50' : '3.30'};
            float axle = position.x > frontAxle-1.0 ? frontAxle :
                         ${art ? '(position.x < -3.0 ? -6.60 : -.15)' : '-3.84'};
            vec3 pivot = vec3(axle,.49,sign(position.z)*1.14);
            if(point) v-=pivot;
            ${i%2===0 ? 'v.xy=yawRotation(wheelAngles.x)*v.xy;' : ''}
            if(axle==frontAxle) {
              v.xz=yawRotation(wheelAngles.y)*v.xz;
            }
            return point ? v+pivot : v;
          }` : ''}
          float motionId() { return floor(uv.y*8.0+.5); }
          float hinge(float id) {
            float centre = id < 2.5 ? ${art ? '8.11' : '5.02'} :
                           id < 4.5 ? ${art ? '-3.95' : '-2.50'} : 2.0;
            return centre + (mod(id,2.0)<.5 ? .51 : -.51);
          }
          mat2 leafRotation(float id) {
            float opening=id<2.5 ? busStopPose.x : busStopPose.y;
            return yawRotation((mod(id,2.0)<.5 ? -1.0 : 1.0)*opening*1.48);
          }
          mat2 jointRotation(float x) {
            return yawRotation(${art ? 'busBend*clamp((-1.57-x)/1.06,0.0,1.0)' : '0.0'});
          }
          vec3 suspension(vec3 p, float id, bool point) {
            if(id>6.5) return p;
            p.xy=yawRotation(.0035*busStopPose.z)*p.xy;
            p.yz=yawRotation(-.027*busStopPose.z)*p.yz;
            if(point) p.y-=.012*busStopPose.z;
            return p;
          }`).replace('#include <begin_vertex>', `
          #include <begin_vertex>
          float doorId=motionId();
          ${hasWheels ? 'if(doorId>6.5) transformed=moveWheel(transformed,true);' : ''}
          if(doorId>.5 && doorId<6.5) {
            vec2 pivot=vec2(hinge(doorId),1.294);
            transformed.xz=pivot+leafRotation(doorId)*(transformed.xz-pivot);
          }
          transformed.xz=jointRotation(position.x)*(transformed.xz+vec2(2.10,0.0))-vec2(2.10,0.0);
          transformed=suspension(transformed,doorId,true);`)
          .replace('#include <beginnormal_vertex>', `
          #include <beginnormal_vertex>
          float normalId=motionId();
          ${hasWheels ? 'if(normalId>6.5) objectNormal=moveWheel(objectNormal,false);' : ''}
          if(normalId>.5 && normalId<6.5) objectNormal.xz=leafRotation(normalId)*objectNormal.xz;
          objectNormal.xz=jointRotation(position.x)*objectNormal.xz;
          objectNormal=suspension(objectNormal,normalId,false);`);
        if(i%2===1) {
          // Open the front skirt for the tyre; keep the painted arch around it.
          shader.vertexShader=shader.vertexShader.replace('#include <common>',
            '#include <common>\nvarying vec4 frontWell;').replace('#include <begin_vertex>', `
            #include <begin_vertex>
            frontWell=vec4(transformed.xy-vec2(${art?'6.50':'3.30'},.49),
                           abs(position.z),motionId());`);
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
            '#include <common>\nvarying vec4 frontWell;').replace('#include <clipping_planes_fragment>', `
            #include <clipping_planes_fragment>
            if(frontWell.w<.5 && frontWell.z>1.20 && dot(frontWell.xy,frontWell.xy)<.375*.375) discard;`);
        }
      };
      mesh.customDepthMaterial = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
      mesh.customDistanceMaterial = new THREE.MeshDistanceMaterial();
      for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial]) {
        material.onBeforeCompile = deform;
        material.customProgramCacheKey = () => 'xcelsior-stop-'+i;
      }
      if (!mesh.material.transparent && mesh.geometry.hasAttribute('uv')) {
        const lights = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        lights.setUsage(THREE.DynamicDrawUsage);
        mesh.geometry.setAttribute('busLights', lights);
        const bendShader = mesh.material.onBeforeCompile.bind(mesh.material);
        mesh.material.onBeforeCompile = shader => {
          bendShader(shader);
          shader.vertexShader = shader.vertexShader.replace('#include <common>', `
            #include <common>
            attribute vec3 busLights;
            varying vec3 lensEmission;`).replace('#include <begin_vertex>', `
            #include <begin_vertex>
            float role = floor(uv.x * 4.0 + 0.5);
            float night = busLights.x;
            lensEmission = vec3(0.0);
            if (role == 1.0) lensEmission = vec3(1.0, .94, .82) * mix(.7, 4.5, night);
            // The flutes catch light from the headlamp across their ridges and returns.
            // Cabin light falls off toward the dashboard behind the distant windshield.
            // Light falls across the passenger windows on both articulated sections.
            // Light through the front boarding doors falls off toward the steps.
            if (role == 14.0) lensEmission = vec3(.16,.145,.115)*night*
              mix(.12,.90,smoothstep(.76,2.59,position.y));
            if (role == 13.0) lensEmission = vec3(.16, .145, .115) * night *
              mix(.20, 1.0, smoothstep(1.44, 2.74, position.y));
            if (role == 12.0) lensEmission = vec3(.113, .092, .070) * night *
              mix(.24, 1.0, smoothstep(1.39, 2.47, position.y));
            if (role == 10.0) lensEmission = vec3(1.0, .94, .82) * 2.4 * night;
            if (role == 11.0) lensEmission = vec3(1.0, .94, .82) * 1.1 * night;
            if (role == 2.0) lensEmission = vec3(1.0, .025, .008) * (.52 * night + (position.y < 2.0 ? 3.0 * busLights.y : 0.0));
            if (role == 9.0) lensEmission = vec3(1.0, .025, .008) * 3.0 * busLights.y;
            if (role == 3.0) lensEmission = vec3(1.0, .36, .025) * (.17 + 1.55 * night);
            if (role == 5.0) lensEmission = vec3(1.0, .95, .82) * 1.8 * night;
            if (role == 7.0) lensEmission = vec3(.68, .65, .56) * night;
            ${i === 0 ? `if (role == 7.0 && abs(position.y-2.7475)<.002 && abs(abs(position.z)-1.285)<.002) {
              vec3 centre = (modelMatrix * instanceMatrix)[3].xyz;
              lensEmission *= 1.0-smoothstep(100.0,120.0,length(cameraPosition.xz-centre.xz));
            }` : ''}
            if (role == 8.0) lensEmission = vec3(.44, .32, .12) * night;
            if (role == 6.0) {
              lensEmission = vec3(.044, .078, .115) * night;
              ${art ? '' : `// More cabin light reaches the exposed shoulder than the recessed base.
              float shoulder = smoothstep(1.305, 1.80, position.y);
              lensEmission += vec3(.22, .29, .33) * shoulder * night;`}
            }
            if (role == 4.0 && position.z * busLights.z > 0.0)
              lensEmission = vec3(1.0, .26, .008) * 3.8;`);
          shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
            '#include <common>\nvarying vec3 lensEmission;').replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lensEmission;');
          if(i%2===1) {
            // Shade the dashboard and steering rim within the far windshield panes.
            shader.vertexShader=shader.vertexShader.replace('#include <common>',
              '#include <common>\nvarying vec4 cabPane;').replace('#include <begin_vertex>',
              '#include <begin_vertex>\ncabPane=vec4(position.zy,1.0-step(.025,abs(uv.x-3.0)),(1.0-step(.025,abs(uv.x-3.25)))*busLights.x);');
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
              '#include <common>\nvarying vec4 cabPane;').replace('totalEmissiveRadiance += lensEmission;', `
              vec3 cabinLight=lensEmission;
              ${art ? `// Keep the lower exit paint opaque around the illuminated opening.
              float exitDistance=min(abs(busLocal.x+3.95),abs(busLocal.x-2.0));
              float exitLeaf=abs(exitDistance-.26);
              if(busLocal.z>1.289 && exitLeaf<.22 && busLocal.y>.405 && busLocal.y<1.41 &&
                 (busLocal.y<.60 || exitLeaf>=.166)) cabinLight=vec3(0.);
              cabinLight=mix(cabinLight,vec3(.13,.094,.042)*plateNight,exitBar);` : `
              cabinLight*=exitTransmission;`}

              if(cabPane.z>.5) {
                float dashTop=1.54+.045*clamp(-cabPane.x,0.,1.);
                float dash=1.-smoothstep(dashTop-.012,dashTop+.012,cabPane.y);
                vec2 rim=(cabPane.xy-vec2(-.63,1.59))/vec2(.19,.14);
                float wheel=1.-smoothstep(.07,.20,abs(length(rim)-1.));
                cabinLight*=1.-.72*max(dash,wheel);
                ${art ? '' : 'cabinLight*=0.125;'}
              }
              // Pixel coverage keeps the narrow brass rails from thickening at distance.
              vec2 railPixel=max(fwidth(vec2(${art ? "busLocal.x" : "grilleLocal.x"},cabPane.y)),vec2(.001));
              if(cabPane.w>0.) {
                float bar=abs(cabPane.y-2.56);
                float barCover=max(0.,min(bar+.5*railPixel.y,.0165)-max(bar-.5*railPixel.y,-.0165))/railPixel.y;
                ${art ? `float x=busLocal.x;
                float start=x < -2.1 ? -9.025 : -1.445;
                float end=x < -2.1 ? -2.755 : 8.705;
                barCover*=step(start,x)*step(x,end);` : `
                float x=grilleLocal.x;
                float post=min(min(abs(x+4.65),abs(x+1.55)),min(abs(x-.95),abs(x-3.25)));
                float postCover=max(0.,min(post+.5*railPixel.x,.019)-max(post-.5*railPixel.x,-.019))/railPixel.x;
                postCover*=1.-smoothstep(2.56-.5*railPixel.y,2.56+.5*railPixel.y,cabPane.y);
                barCover=max(postCover,barCover);`}
                cabinLight=mix(cabinLight,vec3(.44,.32,.12)*cabPane.w,barCover);
              }
              ${art ? `// Match the close mesh's .87 m seat pitch on each articulated section.
              if(cabPane.w>0. && cabPane.y<1.76) {
                float x=busLocal.x;
                bool trailer=x < -2.1;
                float first=trailer ? -8.70 : -1.12;
                float centre=first+.87*floor((x-first)/.87+.5);
                float doorGap=min(abs(centre-8.11),min(abs(centre-2.),abs(centre+3.95)));
                if(centre>=first && centre<(trailer ? -3.48 : 8.30) &&
                   (cabPane.x<0. || doorGap>=.74)) {
                  float widthAA=max(.015,fwidth(x));
                  float seat=(1.-smoothstep(.15-widthAA,.15+widthAA,abs(x-centre)))*
                             (1.-smoothstep(1.71,1.75,cabPane.y));
                  cabinLight=mix(cabinLight,vec3(.044,.078,.115)*cabPane.w,seat);
                }
              }` : `// The local seats recline and taper toward the pale shoulder of the shell.
              if(cabPane.w>0. && cabPane.y<1.82) {
                float x=grilleLocal.x+.13*(cabPane.y-1.305);
                float centre=-5.65+.87*floor((x+5.65)/.87+.5);
                float doorGap=min(abs(centre-5.02),abs(centre+2.50));
                if(centre>=-5.651 && centre<5.25 && (cabPane.x<0. || doorGap>=.74)) {
                  float shoulder=smoothstep(1.71,1.80,cabPane.y);
                  float width=mix(.19,.12,shoulder);
                  float edge=max(.012,fwidth(x));
                  float seat=(1.-smoothstep(width-edge,width+edge,abs(x-centre)))*
                             (1.-smoothstep(1.78,1.82,cabPane.y));
                  vec3 shell=mix(vec3(.065,.095,.12),vec3(.21,.23,.23),shoulder);
                  cabinLight=mix(cabinLight,shell*cabPane.w,seat);
                }
              }`}
              // Approximate the close ceiling diffusers inside the upper passenger panes.
              float feather=max(.005, .5*fwidth(cabPane.y));
              float strip=1.-smoothstep(.022-feather,.022+feather,abs(cabPane.y-2.707));
              ${art ? `// Project the recessed Blender strip slightly above the painted window centre.
              float offset=abs(cabPane.y-2.718);
              float edge=min(feather,.012);
              strip=1.-smoothstep(.022-edge,.022+edge,offset);` : ''}
              vec3 diffuser=vec3(1.,.95,.82)*1.8*strip*cabPane.w;
              ${art ? '' : 'cabinLight+=2.0*diffuser;'}
              // At street distance the glass attenuates the average light from the seats and rails.
              if(cabPane.w>0.) cabinLight*=mix(1.,.065,smoothstep(.05,.23,railPixel.y));
              ${art ? 'cabinLight+=diffuser;' : ''}
              totalEmissiveRadiance += cabinLight;`);
            // Project the close front-leaf handholds onto the closed far door glass.
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>', `
              #include <color_fragment>
              vec3 entryLocal=${art?'busLocal':'grilleLocal'};
              vec2 entryPixel=max(fwidth(entryLocal.xy),vec2(.001));
              float across=abs(abs(entryLocal.x-${art?'8.11':'5.02'})-.395);
              float handhold=0.;
              if(abs(entryLocal.z-1.301)<.003 && across<.015+entryPixel.x) {
                float w=max(0.,min(across+.5*entryPixel.x,.015)-max(across-.5*entryPixel.x,-.015));
                float h=max(0.,min(entryLocal.y+.5*entryPixel.y,1.73)-max(entryLocal.y-.5*entryPixel.y,.93));
                handhold=w*h/(entryPixel.x*entryPixel.y);
                diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.624,.445,.138),handhold);
              }`).replace('vec3 cabinLight=lensEmission;',
              'vec3 cabinLight=lensEmission*(1.-.68*handhold);');
            shader.uniforms.rimMap={value:rimMap};
            shader.vertexShader=shader.vertexShader.replace('#include <common>',
              '#include <common>\nvarying vec4 wheelLocal;').replace('#include <begin_vertex>', `
              #include <begin_vertex>
              float axle=position.x>2.0 ? ${art?'6.50':'3.30'} : ${art?'(position.x < -3.0 ? -6.60 : -.15)':'-3.84'};
              // Inverse rotation samples the same wheel phase as the near mesh.
              wheelLocal=vec4(yawRotation(-wheelAngles.x)*(position.xy-vec2(axle,.49)),motionId()>6.5 && abs(position.z)>1.294 ? 1.0 : 0.0, ${art?"step(axle,-3.0)":"0.0"});`);
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
              '#include <common>\nuniform sampler2D rimMap;\nvarying vec4 wheelLocal;')
              .replace('#include <color_fragment>', `
                #include <color_fragment>
                if(wheelLocal.z>.999 && dot(wheelLocal.xy,wheelLocal.xy)<.49*.49) {
                  vec4 finish=texture2D(rimMap,vec2((.5+wheelLocal.x+wheelLocal.w)*.5,.5+wheelLocal.y));
                  diffuseColor.rgb=mix(diffuseColor.rgb,finish.rgb,finish.a);
                }`);
          }
          if(i===1) {
            shader.uniforms.grilleMap={value:grilleMap};
            shader.vertexShader=shader.vertexShader.replace('#include <common>',
              '#include <common>\nvarying vec3 grilleLocal;').replace('#include <begin_vertex>',
              '#include <begin_vertex>\ngrilleLocal=position;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
              '#include <common>\nuniform sampler2D grilleMap;\nvarying vec3 grilleLocal;')
              .replace('#include <color_fragment>', `
                #include <color_fragment>
                // Eight sloping blue bands climb each Q39 entrance upright.
                float entryX=grilleLocal.x-5.02;
                float fromLeaf=entryX-sign(entryX)*.255;
                float edge=sign(fromLeaf)*.215;
                float fromEdge=fromLeaf-edge;
                if(abs(grilleLocal.z-1.317)<.002 && abs(fromEdge)<.033 &&
                   grilleLocal.y>.405 && grilleLocal.y<1.42) {
                  float height=grilleLocal.y-.431-.045*(edge+.215)-.012*(fromEdge+.031)/.062;
                  float row=clamp(floor((height+.036)/.126),0.,7.);
                  float offset=height-row*.126;
                  float footprint=max(fwidth(height),.001);
                  float ink=max(0.,min(offset+.5*footprint,.054)-max(offset-.5*footprint,0.))/footprint;
                  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.03955,.21953,.49102),ink);
                }
                // Rear exit leaves have a black cross rail beneath each upper pane.
                float exitTransmission=1.;
                if(abs(grilleLocal.x+2.5)<.51 && abs(grilleLocal.z-1.301)<.003 &&
                   grilleLocal.y>.75 && grilleLocal.y<2.60) {
                  float pixel=max(fwidth(grilleLocal.y),.001);
                  float offset=abs(grilleLocal.y-2.185);
                  float rail=max(0.,min(offset+.5*pixel,.033)-max(offset-.5*pixel,-.033))/pixel;
                  exitTransmission=mix(.05,.50,smoothstep(1.40,1.53,grilleLocal.y))*(1.-rail);
                  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.014,.020,.030),rail);
                }
                vec2 grilleUV=(grilleLocal.xy-vec2(2.30,.55))/.25;
                if(grilleLocal.z>1.25 && all(greaterThanEqual(grilleUV,vec2(0.))) &&
                   all(lessThanEqual(grilleUV,vec2(1.)))) {
                  vec4 slats=texture2D(grilleMap,grilleUV);
                  diffuseColor.rgb=mix(diffuseColor.rgb,slats.rgb,slats.a);
                }`);
          }
          if(art) {
            if(i===3) {
              shader.uniforms.hatchMap={value:hatchMap};
              shader.vertexShader=shader.vertexShader.replace('#include <common>',
                '#include <common>\nvarying vec2 rearSignals;').replace('#include <begin_vertex>',
                '#include <begin_vertex>\nrearSignals=busLights.yz;');
              shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
                '#include <common>\nvarying vec2 rearSignals;').replace('#include <opaque_fragment>', `
                // Integrate each horizontal band over a screen pixel at the LOD switch.
                vec2 pixel=max(fwidth(busLocal.zy),vec2(.0001));
                // Fill subpixel brake coverage on the backing plate behind the small lens polygons.
                if(abs(busLocal.x+9.164)<.003 && pixel.y>.04) {
                  float dz=abs(busLocal.z)-1.106;
                  float dy=min(abs(busLocal.y-.92),abs(busLocal.y-1.24));
                  vec2 delta=vec2(dz,dy);
                  vec2 covered=max(min(delta+.5*pixel,vec2(.052))-max(delta-.5*pixel,vec2(-.052)),0.)/pixel;
                  outgoingLight+=vec3(3.,.075,.024)*rearSignals.x*covered.x*covered.y;
                  if(busLocal.z*rearSignals.y>0.) {
                    float turnY=busLocal.y-1.08;
                    float turnCoverage=max(min(turnY+.5*pixel.y,.052)-max(turnY-.5*pixel.y,-.052),0.)/pixel.y;
                    outgoingLight+=vec3(1.,.26,.008)*3.8*covered.x*turnCoverage;
                  }
                }
                vec2 low=busLocal.zy-vec2(0.,1.49)-.5*pixel;
                vec2 high=low+pixel;
                if(busLocal.x < -9.14 && low.x<.24 && high.x>-.24 && low.y<.035 && high.y>-.035) {
                  vec2 bezel=max(min(high,vec2(.24,.035))-max(low,vec2(-.24,-.035)),0.)/pixel;
                  float left=max(min(high.x,-.012)-max(low.x,-.22),0.);
                  float right=max(min(high.x,.22)-max(low.x,.012),0.);
                  float height=max(min(high.y,.021)-max(low.y,-.021),0.);
                  float lens=(left+right)*height/(pixel.x*pixel.y);
                  outgoingLight=mix(outgoingLight,vec3(.009),bezel.x*bezel.y);
                  outgoingLight+=lens*(vec3(.081,0.,.007)+rearSignals.x*vec3(3.,.075,.024));
                }
                #include <opaque_fragment>`);
            }
            if(i===2){
              shader.vertexShader=shader.vertexShader.replace('#include <common>',
                '#include <common>\nvarying float bumperRubber;').replace('float night = busLights.x;',
                'bumperRubber=float(role==15.0); float night = busLights.x;');
              shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
                '#include <common>\nvarying float bumperRubber;').replace('#include <roughnessmap_fragment>',
                '#include <roughnessmap_fragment>\nif(bumperRubber>.5) roughnessFactor=.95;');
            }
            shader.uniforms.sbsMap={value:sbsMap};
            shader.uniforms.fleetMap={value:fleetMap};
            shader.uniforms.operatorMap={value:operatorMap};
            shader.vertexShader=shader.vertexShader.replace('#include <common>',
              '#include <common>\nvarying vec3 busLocal;\nvarying float plateNight;').replace('#include <begin_vertex>',
              '#include <begin_vertex>\nbusLocal=position; plateNight=busLights.x;');
            shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
              (i===3?'uniform sampler2D hatchMap;\n':'')+'#include <common>\nuniform sampler2D operatorMap;\nuniform sampler2D fleetMap;\nuniform sampler2D sbsMap;\nvarying vec3 busLocal;\nvarying float plateNight;')
              .replace('#include <color_fragment>', `
                #include <color_fragment>
                vec2 operatorUV=(busLocal.xy-vec2(-7.55,2.77))/vec2(1.42,.18);
                if(busLocal.z>1.24 && all(greaterThanEqual(operatorUV,vec2(0.))) &&
                   all(lessThanEqual(operatorUV,vec2(1.)))) {
                  vec4 ink=texture2D(operatorMap,operatorUV);
                  diffuseColor.rgb=mix(diffuseColor.rgb,ink.rgb,ink.a);
                }
                ${i===3 ? `
                // Closed M15 passenger exits. Keep their perimeter and centre seals exposed.
                float exitOffset=min(abs(busLocal.x+3.95),abs(busLocal.x-2.0));
                float leafOffset=abs(exitOffset-.26);
                // A mirrored pair of bent brass bars behind each set of exit leaves.
                float barCentre=.193+.220*clamp((busLocal.y-1.27)/.53,0.,1.);
                float distanceToBar=abs(exitOffset-barCentre);
                float barPixel=max(fwidth(exitOffset-barCentre),.001);
                float exitBar=0.;
                if(abs(busLocal.z-1.301)<.003 && busLocal.y>=1.06 && busLocal.y<=1.80) {
                  exitBar=max(0.,min(distanceToBar+.5*barPixel,.014)-
                            max(distanceToBar-.5*barPixel,-.014))/barPixel;
                  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.409,.279,.105),exitBar);
                }
                if(busLocal.z>1.289 && leafOffset<.22 && busLocal.y>.405 && busLocal.y<1.41) {
                  vec3 exitPaint=vec3(.2664,.6376,.7231); // pale blue, linear RGB
                  if(busLocal.y>.53 && busLocal.y<.60) exitPaint=vec3(.0080,.0482,.2232);
                  if(busLocal.y>=.60 && leafOffset<.166) exitPaint=vec3(.0185,.0273,.0319);
                  diffuseColor.rgb=exitPaint;

                }
                vec2 hatchUV=(busLocal.xy-vec2(-9.15,.34))/vec2(2.,1.);
                if(busLocal.z>1.26 && all(greaterThanEqual(hatchUV,vec2(0.))) &&
                   all(lessThanEqual(hatchUV,vec2(1.)))) {
                  vec4 seam=texture2D(hatchMap,hatchUV);
                  diffuseColor.rgb=mix(diffuseColor.rgb,seam.rgb,seam.a);
                }` : ''}
                vec2 sbsUV=(busLocal.xy-vec2(-9.02,.84))/vec2(2.24,.23);
                // Repeat the plain service lettering on the rear cover.
                bool rearCover=busLocal.x < -9.145;
                if(rearCover) sbsUV=(busLocal.zy-vec2(-.72,1.152))/vec2(1.58,.174);
                if((rearCover || busLocal.z>1.26) && all(greaterThanEqual(sbsUV,vec2(0.))) &&
                   all(lessThanEqual(sbsUV,vec2(1.)))) {
                  vec4 letters=texture2D(sbsMap,sbsUV);
                  diffuseColor.rgb=mix(diffuseColor.rgb,letters.rgb,letters.a);
                }
                vec2 fleetUV=(busLocal.zy-vec2(.32,2.21))/vec2(.52,.24);
                vec2 adUV=(busLocal.zy-vec2(-.87,1.59))/vec2(1.46,.46);
                if(rearCover && all(greaterThanEqual(adUV,vec2(0.))) &&
                   all(lessThanEqual(adUV,vec2(1.)))) {
                  diffuseColor.rgb=texture2D(fleetMap,vec2(clamp(adUV.x,.002,.998),clamp(adUV.y,.008,.992)*.5)).rgb;
                }
                float atlasColumn=0.;
                bool plateLamp=rearCover && abs(busLocal.z-.21)<.108 && abs(busLocal.y-.918)<.009;
                if(plateLamp) diffuseColor.rgb=vec3(.69,.75,.73);
                if(rearCover && abs(busLocal.z-.21)<.195 && abs(busLocal.y-.83)<.115) {
                  // The M14 plate sits in a shadowed pocket with a lip above it.
                  if(abs(busLocal.z-.21)>.16 || abs(busLocal.y-.82)>.07) {
                    if(!plateLamp) diffuseColor.rgb*=busLocal.y>.90 ? .25 : .55;
                  }
                  atlasColumn=1.;
                  fleetUV=(busLocal.zy-vec2(.05,.75))/vec2(.32,.14);
                }
                if(busLocal.x< -9.145 && all(greaterThanEqual(fleetUV,vec2(0.))) &&
                   all(lessThanEqual(fleetUV,vec2(1.)))) {
                  vec4 digits=texture2D(fleetMap,vec2((atlasColumn+clamp(fleetUV.x,.004,.996))*.5,.5+.5*clamp(fleetUV.y,.008,.992)));
                  diffuseColor.rgb=mix(diffuseColor.rgb,digits.rgb,digits.a);
                }`).replace('#include <emissivemap_fragment>', `
                #include <emissivemap_fragment>
                if(plateLamp) totalEmissiveRadiance+=plateNight*vec3(.75,.80,.76);
                if(atlasColumn>.5 && all(greaterThanEqual(fleetUV,vec2(0.))) &&
                   all(lessThanEqual(fleetUV,vec2(1.)))) {
                  totalEmissiveRadiance+=diffuseColor.rgb*plateNight*mix(.10,.42,fleetUV.y);
                }`);
          }
        };
        mesh.material.customProgramCacheKey = () => 'xcelsior-wheels-lights-'+i;
      }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = !source.material.transparent;
      mesh.receiveShadow = true;
      if (source.material.transparent) {
        const world = game.world;
        if (world.shared?.tStreet && world.streetRT && !world.streetOff) {
          const deformGlass = mesh.material.onBeforeCompile.bind(mesh.material);
          mesh.material.onBeforeCompile = shader => {
            deformGlass(shader);
            shader.uniforms.busStreetCube = world.shared.tStreet;
            shader.uniforms.busReflectionStrength = reflectionStrength;
            shader.uniforms.busProbePosition = {value:world.streetCam?.position || new THREE.Vector3()};
            shader.uniforms.busLocalReflection = localReflection;
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
              #include <common>
              uniform samplerCube busStreetCube;
              uniform float busReflectionStrength;
              uniform vec3 busProbePosition;
              uniform float busLocalReflection;`).replace('#include <opaque_fragment>', `
              vec3 reflected = inverseTransformDirection(reflect(-normalize(vViewPosition),normal),viewMatrix);
              // Use the same street-width approximation as the game's vehicle glass.
              vec3 surface = cameraPosition - transpose(mat3(viewMatrix))*vViewPosition;
              float wallDistance = 11.0/max(length(reflected.xz),.2);
              float groundDistance = reflected.y < -.01 ? max(surface.y,0.0)/-reflected.y : 1e4;
              vec3 fromProbe = surface + reflected*min(wallDistance,groundDistance) - busProbePosition;
              if(busLocalReflection>.5 && dot(fromProbe,fromProbe)>.0001) reflected=normalize(fromProbe);
              vec3 street = min(textureCube(busStreetCube,reflected).rgb,vec3(3.0));
              float grazing = 1.0-abs(dot(normalize(vViewPosition),normal));
              float weight = busReflectionStrength*(.045+.635*pow(grazing,5.0));
              outgoingLight=mix(outgoingLight,street,weight);
              diffuseColor.a=mix(diffuseColor.a,1.0,weight);
              #include <opaque_fragment>`);
          };
          mesh.material.customProgramCacheKey = () => 'bus-street-glass-'+i;
        }
        source.material.depthWrite = false;
        source.material.forceSinglePass = true;
      }
      group.add(mesh);
      parts.push(mesh);
    });
    return parts;
  });
  const meshes = batches.flat();
  game.world.scene.add(group);
  const pose = new THREE.Object3D();
  const suspension = new THREE.Quaternion(), tilt = new THREE.Euler();
  // Each route gets its own legible, correctly addressed sign on the near exterior.
  const boardGeometry = new THREE.PlaneGeometry(2.14, .275);
  boardGeometry.rotateY(Math.PI / 2);
  const routes = [{num:'',head:'NOT IN SERVICE'}, ...(opts.signs || [])];
  function routeNumber(route) {
    const number=String(route.num || '').toUpperCase();
    return number && route.sel && !number.endsWith('+') ? number+'+' : number;
  }
  const signs = routes.map(route => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#151a1c'; ctx.fillRect(0, 0, 640, 96);
    // Rasterise on a small LED matrix, then paint only the lit emitters.
    const matrix = document.createElement('canvas');
    matrix.width = 160; matrix.height = 24;
    const pixels = matrix.getContext('2d');
    pixels.fillStyle = 'white';
    const number=routeNumber(route);
    const destination=String(route.head || '').toUpperCase();
    pixels.font='bold 23px monospace';
    const numberWidth=number ? Math.min(68,Math.ceil(pixels.measureText(number).width)) : 0;
    if(number) pixels.fillText(number,1,20,numberWidth);
    const xText=number ? numberWidth+5 : 1;
    const textWidth=matrix.width-xText-1;
    if(route.via) {
      pixels.font='bold 13px monospace';
      pixels.fillText(destination,xText,11,textWidth);
      pixels.font='bold 11px monospace';
      pixels.fillText(String(route.via).toUpperCase(),xText,22,textWidth);
    } else {
      pixels.font='bold 18px monospace';
      pixels.fillText(destination,xText,18,textWidth);
    }
    const glyphs = pixels.getImageData(0,0,matrix.width,matrix.height).data;
    for(let y=0;y<matrix.height;y++) for(let x=0;x<matrix.width;x++) {
      const coverage=glyphs[(y*matrix.width+x)*4+3];
      if (coverage < 35) continue;
      ctx.fillStyle = coverage < 115 ? '#ad702f' : '#ffb64f';
      ctx.fillRect(x * 4, y * 4, 3, 3);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({map});
  });
  const sideBoardGeometry = new THREE.PlaneGeometry(1.21, .20);
  const rearBoardGeometry = new THREE.PlaneGeometry(.58,.27);
  rearBoardGeometry.rotateY(-Math.PI/2);
  const rearSigns = routes.map(route => {
    const canvas = document.createElement('canvas');
    canvas.width=80; canvas.height=36;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#191d1d'; ctx.fillRect(0,0,80,36);
    ctx.font='bold 28px monospace'; ctx.textAlign='center';
    ctx.fillStyle='#e7a642'; ctx.fillText(routeNumber(route),40,28,74);
    const map=new THREE.CanvasTexture(canvas);
    map.colorSpace=THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({map});
  });
  // Sample the same route artwork on the far Blender bezel, within its existing draw.
  const atlasCanvas = document.createElement('canvas');
  const columns = Math.ceil(Math.sqrt(routes.length));
  const rows = Math.ceil(routes.length / columns);
  const tileWidth=320, tileHeight=48;
  atlasCanvas.width = columns * tileWidth;
  atlasCanvas.height = rows * tileHeight * 2;
  const atlasContext = atlasCanvas.getContext('2d');
  for (const [bank,materials] of [rearSigns,signs].entries()) {
    materials.forEach((material,index) => atlasContext.drawImage(material.map.image,
      (index % columns)*tileWidth, (bank*rows+Math.floor(index/columns))*tileHeight,
      tileWidth,tileHeight));
  }
  const routeAtlas = new THREE.CanvasTexture(atlasCanvas);
  routeAtlas.colorSpace = THREE.SRGBColorSpace;
  routeAtlas.generateMipmaps = false;
  routeAtlas.minFilter = THREE.LinearFilter;
  const flagCanvas=document.createElement('canvas');
  flagCanvas.width=247; flagCanvas.height=130;
  const flagPaint=flagCanvas.getContext('2d');
  flagPaint.fillStyle='#e4deda';
  flagPaint.fillRect(0,0,247,130);
  flagPaint.fillStyle='#b54149';
  for(let row=0;row<13;row+=2) flagPaint.fillRect(0,row*10,247,10);
  flagPaint.fillStyle='#314976';
  flagPaint.fillRect(147,0,100,70);
  flagPaint.fillStyle='#e4deda';
  for(let row=0;row<9;row++) {
    for(let col=0;col<6-row%2;col++) {
      flagPaint.fillRect(153+col*16+(row%2)*8,4+row*7.5,4,4);
    }
  }
  const flagMap=new THREE.CanvasTexture(flagCanvas);
  flagMap.colorSpace=THREE.SRGBColorSpace;
  for (const mesh of [...batches[1],...batches[3]]) {
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const coords = new Float32Array(pos.count * 2).fill(-1);
    for (let i=0; i<pos.count; i++) {
      const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
      const nose=mesh===batches[1][0] ? 6.1 : 9.15;
      const sideCentre=nose-(mesh===batches[1][0] ? 4.78 : 2.36);
      if (Math.abs(x-nose-.046)<.004 && y>2.52 && y<2.80 && Math.abs(z)<1.075) {
        coords[2*i]=2+(1.07-z)/2.14;
        coords[2*i+1]=(y-2.525)/.27;
      } else if (Math.abs(z-1.306)<.004 && Math.abs(Math.abs(x-sideCentre)-.605)<.004 &&
                 Math.abs(Math.abs(y-2.54)-.10)<.004) {
        coords[2*i]=2+(x-sideCentre+.605)/1.21;
        coords[2*i+1]=(y-2.44)/.20;
      } else if (Math.abs(z-1.312)<.003 && Math.abs(Math.abs(x+6.59)-.32)<.005 &&
                 Math.abs(Math.abs(y-1.949)-.169)<.004) {
        coords[2*i]=4+(x+6.91)/.64;
        coords[2*i+1]=(y-1.78)/.338;
      } else if (Math.abs(x+9.157)<.004 && y>2.48 && y<2.90 && z>.23 && z<.95) {
        coords[2*i]=(z-.24)/.70;
        coords[2*i+1]=(y-2.49)/.40;
      }
    }
    geometry.setAttribute('rearDisplayUV',new THREE.BufferAttribute(coords,2));
    geometry.setAttribute('rearRoute',new THREE.InstancedBufferAttribute(new Float32Array(cap),1)
      .setUsage(THREE.DynamicDrawUsage));
    const lightsShader = mesh.material.onBeforeCompile;
    mesh.material.onBeforeCompile = shader => {
      lightsShader(shader);
      shader.uniforms.flagMap={value:flagMap};
      shader.uniforms.routeAtlas = {value:routeAtlas};
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        attribute vec2 rearDisplayUV;
        attribute float rearRoute;
        varying vec2 displayUV;
        varying float displayRoute;`).replace('#include <begin_vertex>', `
        #include <begin_vertex>
        displayUV=rearDisplayUV;
        displayRoute=rearRoute;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        uniform sampler2D flagMap;
        uniform sampler2D routeAtlas;
        varying vec2 displayUV;
        varying float displayRoute;`).replace('#include <opaque_fragment>', `
        if(displayUV.x>-.01 && displayUV.x<3.1) {
          vec2 tile=vec2(mod(displayRoute,${columns}.0),${rows-1}.0-floor(displayRoute/${columns}.0));
          bool frontDisplay=displayUV.x>1.5;
          if(!frontDisplay) tile.y+=${rows}.0;
          vec2 uv=clamp(displayUV-vec2(frontDisplay?2.0:0.0,0.0),vec2(.002,.011),vec2(.998,.989));
          outgoingLight=texture2D(routeAtlas,(tile+uv)/vec2(${columns}.0,${2*rows}.0)).rgb;
        }
        #include <opaque_fragment>`).replace('#include <color_fragment>', `
        #include <color_fragment>
        if(displayUV.x>3.5) diffuseColor.rgb*=texture2D(flagMap,clamp(displayUV-vec2(4.,0.),0.,1.)).rgb;`);
    };
    mesh.material.customProgramCacheKey = () => 'xcelsior-far-route-'+(mesh===batches[1][0]?'40-':'60-')+columns+'-'+rows;
  }
  let rearCount=0;
  const boards = Array.from({length:cap}, () => {
    const board = new THREE.Mesh(boardGeometry, signs[0]);
    const side = new THREE.Mesh(sideBoardGeometry, signs[0]);
    const rear=new THREE.Mesh(rearBoardGeometry,rearSigns[0]);
    board.add(side,rear);
    group.add(board); return board;
  });
  // Track the trailing axle from the hinge displacement. The game supplies
  // map coordinates in metres and heading counterclockwise from map +X.
  const trailers = new Map();
  let frame = 0;
  function jointAngle(b) {
    const h = b.h || 0;
    const hx = b.x - 2.10 * Math.cos(h), hy = b.y - 2.10 * Math.sin(h);
    const prev = trailers.get(b.id);
    let rear = h;
    if (Number.isFinite(b.trailerHeading)) rear = b.trailerHeading;
    else if (prev && frame - prev.frame <= 1 && Math.hypot(hx-prev.hx, hy-prev.hy) < 6) {
      rear = Math.atan2(hy-prev.ay, hx-prev.ax);
    }
    const angle = THREE.MathUtils.clamp(Math.atan2(Math.sin(rear-h),Math.cos(rear-h)), -.61, .61);
    if (b.id != null) trailers.set(b.id, {frame,hx,hy,ax:hx-4.50*Math.cos(h+angle),ay:hy-4.50*Math.sin(h+angle)});
    return angle;
  }
  let used = 0, blinkOn = false;
  return {
    ...original,
    begin() {
      original.begin(); used = 0; rearCount=0; frame++;
      blinkOn = performance.now() % 760 < 400;
      for (const batch of meshes) batch.count = 0;
      for (const board of boards) board.visible = false;
    },
    add(b) {
      // The fleet currently simulates a 40-footer. Keep all interactive views
      // in its original cabin and show the articulated exterior only on explicit supply.
      const art = b.model === 'XD60';
      const angle = art ? jointAngle(b) : 0;
      if (b.inside || (b.id != null && game.player?.vehicle?.bus?.id === b.id)) return original.add(b);
      const far = b.d >= 120;
      const parts = batches[(art ? 2 : 0) + Number(far)];
      if (parts[0].count >= cap) return original.add(b);
      pose.position.set(b.x, b.z || 0, -b.y);
      pose.rotation.set(b.roll || 0, b.h || 0, b.pitch || 0, 'YZX');
      pose.updateMatrix();
      for (const mesh of parts) {
        if (art) mesh.geometry.attributes.busBend.setX(mesh.count, angle);
        mesh.geometry.attributes.busStopPose.setXYZ(mesh.count, b.doorF || 0, b.doorR || 0, b.kneel || 0);
        if (mesh.geometry.attributes.rearRoute) {
          const index=b.sign+1;
          mesh.geometry.attributes.rearRoute.setX(mesh.count,rearSigns[index] ? Number(index) : 0);
        }
        const wheels = mesh.geometry.attributes.wheelAngles;
        if (wheels) wheels.setXY(mesh.count, (b.spin || 0) % (2*Math.PI), b.steer || 0);
        const lights = mesh.geometry.attributes.busLights;
        if (lights) lights.setXYZ(mesh.count, THREE.MathUtils.clamp(b.night || 0, 0, 1),
          b.brake ? 1 : 0, blinkOn ? Math.sign(b.blink || 0) : 0);
        mesh.setMatrixAt(mesh.count++, pose.matrix);
      }
      if (!far && used < cap) {
        const board = boards[used++];
        board.material = signs[b.sign + 1] || signs[0];
        const side = board.children[0];
        side.material = board.material;
        // Child coordinates are relative to the front display before kneeling.
        side.position.set(art ? -2.32 : -4.74, -.125, 1.306);
        board.position.set((art ? 9.15 : 6.1) -.040, 2.665, 0);
        const rear=board.children[1];
        rear.visible=art;
        if(art) {
          rearCount++;
          rear.material=rearSigns[b.sign+1] || rearSigns[0];
          // Bend about the trailer hinge in body space, then inherit suspension
          // and vehicle attitude from the parent front board.
          const dx=-9.214+2.10, dz=.59, ca=Math.cos(angle), sa=Math.sin(angle);
          rear.position.set(-2.10+ca*dx+sa*dz-board.position.x,
            2.69-board.position.y,-sa*dx+ca*dz);
          rear.rotation.y=angle;
        }
        const k = b.kneel || 0;
        suspension.setFromEuler(tilt.set(.027*k, 0, -.0035*k, 'XYZ'));
        board.position.applyQuaternion(suspension);
        board.position.y -= .012*k;
        board.position.applyMatrix4(pose.matrix);
        board.quaternion.copy(pose.quaternion).multiply(suspension); board.visible = true;
      }
    },
    end() {
      original.end();
      for (const [id, state] of trailers) if (state.frame < frame) trailers.delete(id);
      for (const mesh of meshes) if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true;
        if(mesh.geometry.attributes.rearRoute) mesh.geometry.attributes.rearRoute.needsUpdate=true;
        if(mesh.geometry.attributes.wheelAngles) mesh.geometry.attributes.wheelAngles.needsUpdate=true;
        mesh.geometry.attributes.busStopPose.needsUpdate = true;
        if (mesh.geometry.attributes.busLights) mesh.geometry.attributes.busLights.needsUpdate = true;
        if (mesh.geometry.attributes.busBend) mesh.geometry.attributes.busBend.needsUpdate = true;
      }
    },
    stats() {
      const s = original.stats();
      return {draws:s.draws + meshes.filter(m => m.count).length + used * 2 + rearCount,
        tris:s.tris + meshes.reduce((n,m) => n + m.count * m.geometry.index.count / 3, used * 4 + rearCount * 2)};
    },
    dispose() {
      original.dispose(); group.removeFromParent();
      for (const m of meshes) { m.customDepthMaterial?.dispose(); m.customDistanceMaterial?.dispose(); m.dispose(); m.geometry.dispose(); m.material.dispose(); }
      for (const mat of [...signs,...rearSigns]) { mat.map.dispose(); mat.dispose(); }
      grilleMap.dispose();
      rimMap.dispose();
      hatchMap.dispose();
      sbsMap.dispose();
      fleetMap.dispose();
      operatorMap.dispose();
      flagMap.dispose();
      routeAtlas.dispose();
      boardGeometry.dispose(); sideBoardGeometry.dispose(); rearBoardGeometry.dispose();
    }
  };
}
