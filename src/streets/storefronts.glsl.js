// storefronts.glsl.js: shader text of the storefront layer (two patched MeshStandardMaterials: solid pieces, shop glass).
export const SF_COMMON = /* glsl */`
float sfH1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 sfH3(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float sfN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(sfH1(i), sfH1(i+vec2(1,0)), f.x), mix(sfH1(i+vec2(0,1)), sfH1(i+vec2(1,1)), f.x), f.y); }
float sfFbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*sfN(p); p = p*2.03+17.1; a *= .5; } return s; }
vec3 sfUnpack(float f){ vec3 v = vec3(mod(f, 256.0), mod(floor(f / 256.0), 256.0), floor(f / 65536.0)) / 255.0; return v * v; }
// lettering atlas: cells 0..79 signs (512x80), 100..131 small squares (128x128 from y 1760), 200..215 tag lines (512x40 from y 1600)
float sfAspect(float c){ return c < 99.5 ? 6.4 : (c < 199.5 ? 1.0 : 12.8); }
vec3 sfMask(float c, vec2 q){
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec3(0.0);
  q = clamp(q, vec2(0.004, 0.03), vec2(0.996, 0.97)); vec2 px;
  if (c < 99.5) px = vec2((mod(c, 4.0) + q.x) * 512.0, (floor(c / 4.0) + 1.0 - q.y) * 80.0);
  else if (c < 199.5) { c -= 100.0; px = vec2((mod(c, 16.0) + q.x) * 128.0, 1760.0 + (floor(c / 16.0) + 1.0 - q.y) * 128.0); }
  else { c -= 200.0; px = vec2((mod(c, 4.0) + q.x) * 512.0, 1600.0 + (floor(c / 4.0) + 1.0 - q.y) * 40.0); }
  return texture2D(tMask, vec2(px.x, 2048.0 - px.y) / 2048.0, -0.8).rgb;
}
vec3 sfBake(vec2 xz){ return texture2D(tLight, vec2(xz.x / (2.0 * uHalf.x) + 0.5, -xz.y / (2.0 * uHalf.y) + 0.5)).rgb; }
`;

// ------------------------------------------------------------------------------------------------ solid pieces (boxes, awnings)
export const BOX_VERT_PARS = /* glsl */`
attribute vec4 aCol; attribute vec4 aPar;
varying vec4 vCol; varying vec4 vPar; varying vec3 vWPos; varying vec3 vLN; varying vec3 vSc; varying vec2 vUv0; varying vec3 vOut; varying vec3 vAl; varying float vBoxH;`;
export const BOX_VERT = /* glsl */`
vCol = aCol; vPar = aPar; vLN = normal; vUv0 = uv; vBoxH = 0.0;
#ifdef USE_INSTANCING
  vBoxH = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  vOut = normalize((modelMatrix * instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz); vAl = normalize((modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
#else
  vSc = vec3(1.0); vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vOut = vec3(0.0, 0.0, 1.0); vAl = vec3(1.0, 0.0, 0.0);
#endif`;
export const BOX_FRAG_PARS = /* glsl */`
varying vec4 vCol; varying vec4 vPar; varying vec3 vWPos; varying vec3 vLN; varying vec3 vSc; varying vec2 vUv0; varying vec3 vOut; varying vec3 vAl; varying float vBoxH;
uniform sampler2D tMask; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
precision highp sampler2DArray; uniform sampler2DArray tDet; uniform sampler2DArray tDetN; uniform vec3 uDetMean[4];
vec3 bakeV; vec3 bakeN; vec3 sfAlb; float sfRough; float sfMetal; vec3 sfEmis; vec3 sfBump;
` + SF_COMMON + /* glsl */`
// photographed detail (0 sandstone blocks, 1 worn brick, 2 chipped painted metal, 3 roller shutter): colour over its mean, and its normal
vec3 sfDet(int layer, vec2 uv, vec3 T, vec3 B, float ns, inout vec3 bump){
  vec3 d = texture(tDet, vec3(uv, float(layer))).rgb; vec3 nt = texture(tDetN, vec3(uv, float(layer))).xyz * 2.0 - 1.0;
  bump += (T * nt.x + B * nt.y) * ns; return clamp(d / uDetMean[layer], 0.25, 2.2);
}
void sfPaint(inout vec3 c, inout float rough, inout float metal, vec2 m, float wear, float n1){
  vec3 d = texture(tDet, vec3(m / 1.4 + vPar.w * vec2(3.7, 9.1), 2.0)).rgb; float l = dot(d, vec3(0.3333)) / dot(uDetMean[2], vec3(0.3333));
  float rust = smoothstep(0.03, 0.14, d.r - d.g) * smoothstep(0.56, 0.72, n1) * wear;
  c *= mix(1.0, clamp(l, 0.5, 1.5), 0.6 * (1.0 - rust)); c = mix(c, vec3(0.16, 0.065, 0.03) * (0.6 + 0.8 * d.r), rust); rough = mix(rough, 0.9, rust); metal *= 1.0 - rust;
}
vec3 sfSignBlock(float cell, vec2 m, vec2 fs, float fill){     // lettering block centred on a face of fs metres
  float bh = fs.y * fill, bw = bh * sfAspect(cell); float s = min(1.0, fs.x * 0.92 / bw); bh *= s; bw *= s;
  return vec3((m.x - fs.x * 0.5) / bw + 0.5, (m.y - fs.y * 0.5) / bh + 0.5, bh);
}
void sfSurface(){
  int kind = int(vCol.a + 0.5); vec3 c = vCol.rgb; float rough = 0.8, metal = 0.0; vec3 emis = vec3(0.0), bump = vec3(0.0);
  vec3 an = abs(vLN); vec2 fs = an.z > 0.5 ? vSc.xy : (an.x > 0.5 ? vSc.zy : vSc.xz); vec2 m = vUv0 * fs;
  vec2 wp = vec2(dot(vWPos.xz, vec2(0.71, 0.70)), vWPos.y);
  vec3 fT = an.x > 0.5 ? vOut : vAl; vec3 fB = an.y > 0.5 ? vOut : vec3(0.0, 1.0, 0.0);
  float n1 = sfFbm(wp * 0.7 + vPar.w * 37.0), n2 = sfN(wp * 11.0), n3 = sfN(wp * 47.0);
  float grime = 1.0;
  if (kind == 0) {                                   // paint or bare metal: x rough, y metal, z wear
    rough = vPar.x; metal = vPar.y; c *= 0.9 + 0.2 * sfFbm(vec2(wp.x * 2.3, wp.y * 0.5) + vPar.w * 37.0) * vPar.z + 0.1 * (1.0 - vPar.z); c *= 1.0 - 0.14 * vPar.z * step(0.8, n2 * n1 * 2.0);
    c = mix(c, vec3(dot(c, vec3(0.3333))) + 0.012, 0.22 * vPar.z * (0.4 + n1)); c *= 0.93 + 0.14 * n3; { vec2 e0 = min(m, fs - m); c *= 0.86 + 0.14 * smoothstep(0.0, 0.02, min(e0.x, e0.y)); }
    rough = clamp(rough + 0.25 * (n2 - 0.5) * vPar.z, 0.08, 1.0); sfPaint(c, rough, metal, m, vPar.z, n1);
  } else if (kind == 1) {                            // masonry: x 0 ashlar, 1 brick, 2 painted and panelled, 3 metal panels
    float aa = 1.0;
    if (vPar.x < 0.5) { float mxs = vBoxH < 0.5 ? m.x : -m.x; vec3 d = sfDet(0, vec2(mxs / 4.1 + vBoxH * 7.3, 0.13 + 0.74 * abs(fract(m.y / 6.3 + vBoxH * 3.1) * 2.0 - 1.0)), fT, fB, 0.8, bump);
      vec3 d2 = texture(tDet, vec3(vec2(wp.x / 17.0 + 0.3, 0.2 + 0.6 * abs(fract(wp.y / 23.0) * 2.0 - 1.0)), 0.0)).rgb / uDetMean[0];
      d = mix(vec3(dot(d, vec3(0.3333))), d, 0.45); c *= clamp(d, 0.6, 1.45) * (0.8 + 0.2 * clamp(dot(d2, vec3(0.3333)), 0.5, 1.5)); rough = 0.92; }
    else if (vPar.x < 1.5) { c *= sfDet(1, m / 2.6 + vBoxH * vec2(5.3, 1.7), fT, fB, 0.8, bump); rough = 0.95; }
    else if (vPar.x < 2.5) { vec2 e = min(m, fs - m); float inset = min(e.x, e.y); float ln = smoothstep(0.012, 0.0, abs(inset - 0.09)) * step(0.5, fs.x) ;
      c *= 1.0 - 0.35 * ln; c *= 1.0 + 0.2 * smoothstep(0.012, 0.0, abs(inset - 0.105)) * step(0.5, fs.x); float chip = smoothstep(0.80, 0.84, sfFbm(wp * 13.0 + vPar.w * 9.0) + 0.22 * smoothstep(0.7, 0.0, vWPos.y - 0.15));
      c = mix(c, c * 0.55 + vec3(0.04, 0.03, 0.025), chip * 0.4); rough = 0.6; sfPaint(c, rough, metal, m, 1.0, n1); }
    else { float j = smoothstep(0.012, 0.004, abs(fract(m.x / 1.2) - 0.5) * 1.2 - 0.59); c *= 1.0 - 0.5 * j; rough = 0.38; metal = 0.75; }
    c *= 0.86 + 0.28 * n1;
  } else if (kind == 2) {                            // roll-down gate: x slat pitch
    float pitch = vPar.x; c *= sfDet(3, vec2(m.x / 3.0 + vPar.w, m.y * (0.0667 / pitch) / 3.0), fT, fB, 1.7, bump);
    vec2 pb = floor(vec2(m.x / 0.9 + n1 * 0.6, m.y / 0.55) + vPar.w * 13.0); float ph = sfH1(pb);
    c = mix(c, c * vec3(1.25, 1.2, 1.1) + 0.02, step(0.78, ph) * step(m.y, 2.1) * step(0.2, m.y));           // roller-painted patches over old tags
    c = mix(c, vec3(0.16, 0.07, 0.03), 0.5 * smoothstep(0.55, 0.8, sfFbm(vec2(wp.x * 2.0, wp.y * 0.4) + 5.0)) * smoothstep(1.2, 0.0, m.y));   // rust creeping up
    c *= 0.62 + 0.4 * n1; c *= 1.0 - 0.3 * smoothstep(0.45, 0.8, sfFbm(vec2(wp.x * 5.0, wp.y * 0.25) + 11.0)); c = mix(c, c * vec3(0.5, 0.52, 0.6), step(0.9, sfH1(pb + 5.0)) * step(m.y, 1.9)); rough = 0.7; metal = 0.2; if (m.y < 0.09) { c = vec3(0.05); rough = 0.5; }
  } else if (kind == 3) {                            // sign face: x cell, y style, z lettering colour, w seed
    vec3 fg = sfUnpack(vPar.z); float st = vPar.y; float sd = vPar.w; c = min(c, vec3(0.6));
    if (an.z > 0.5) {
      vec3 q = sfSignBlock(vPar.x, m, fs, (st > 1.5 && st < 2.5 ? 0.74 : 0.84) * mix(0.72, 1.0, sfH1(vec2(floor(sd * 4096.0), 5.0)))); vec3 mk = sfMask(vPar.x, q.xy);
      float chipn = sfFbm(m * vec2(7.0, 9.0) + sd * 33.0); float fade = sfH1(vec2(floor(sd * 4096.0), 3.0));
      vec2 e = min(m, fs - m); float inset = min(e.x, e.y);
      if (st < 0.5) {                                // painted board
        float ink = max(mk.r, mk.g) * (1.0 - 0.7 * smoothstep(0.66, 0.74, chipn) * step(0.86, fade));
        c = mix(c, fg, ink); c = mix(c, mix(fg, c, 0.4), mk.b); c = mix(c, fg, 0.8 * smoothstep(0.008, 0.0, abs(inset - 0.035)) * step(0.3, fs.y));
        c = mix(c, vec3(dot(c, vec3(0.3333))) * 1.12 + 0.02, 0.12 + 0.5 * fade * fade); rough = 0.55 + 0.3 * fade;
      } else if (st < 1.5) {                         // channel letters standing off the fascia
        float lt = max(mk.r, mk.g); float below = sfMask(vPar.x, q.xy + vec2(-0.004, 0.085)).r; float under = sfMask(vPar.x, q.xy + vec2(0.0, 0.05)).r;
        c *= 1.0 - 0.6 * below * (1.0 - lt); c = mix(c, fg * 0.38, under * (1.0 - lt)); c = mix(c, fg, lt); rough = mix(0.8, 0.28, lt);
      } else if (st < 2.5) {                         // light box
        float lt = max(mk.r, mk.g); c = mix(c, fg, lt); c = mix(c, mix(fg, c, 0.5), mk.b); c *= 0.9 + 0.1 * smoothstep(0.0, 0.25, inset);
        emis = c * 0.20 * (1.0 - 0.6 * fade); rough = 0.3; float dirt = sfFbm(vec2(m.x * 1.5, m.y * 9.0) + sd * 7.0); c *= 1.0 - 0.25 * smoothstep(0.5, 0.8, dirt);
        if (inset < 0.03) { c = vec3(0.10, 0.10, 0.105); emis = vec3(0.0); metal = 0.6; rough = 0.45; }
      } else {                                       // gilded lettering
        float lt = max(mk.r, mk.g); c = mix(c, vec3(0.83, 0.61, 0.24), lt); metal = lt; rough = mix(0.7, 0.32, lt); c = mix(c, c * 0.7, mk.b);
      }
    } else { c *= 0.6; rough = 0.6; }
  } else if (kind == 4) {                            // awning fabric (the awning mesh: uv.y zone 0 top, 2 valance, 4 sides)
    float zone = floor(vUv0.y * 0.5 + 0.01); vec2 uvl = vec2(vUv0.x, vUv0.y - 2.0 * zone);
    float hyp = length(vec2(0.7 * vSc.y, vSc.z)); float vh = 0.3 * vSc.y;
    vec2 mm = zone < 0.5 ? vec2(uvl.x * vSc.x, uvl.y * hyp) : (zone < 1.5 ? vec2(uvl.x * vSc.x, uvl.y * vh) : vec2(uvl.x * vSc.z, uvl.y * vSc.y));
    float flags = vPar.y; bool stripes = mod(flags, 2.0) > 0.5, scallop = mod(floor(flags / 2.0), 2.0) > 0.5, topText = mod(floor(flags / 4.0), 2.0) > 0.5;
    vec3 fg = sfUnpack(vPar.z); vec3 base = c;
    if (stripes && zone < 1.5) c = mix(c, vec3(0.62, 0.60, 0.54), step(0.5, fract(mm.x / 0.26)));
    if (zone > 0.5 && zone < 1.5) {
      if (scallop) { float xx = fract(mm.x / 0.24) - 0.5; float ed = 0.07 * (1.0 - sqrt(max(0.0, 1.0 - 4.0 * xx * xx))); if (mm.y < ed) discard; c = mix(c, fg, 0.7 * smoothstep(0.012, 0.004, abs(mm.y - ed - 0.022))); }
      if (vPar.x > -0.5) { vec2 fz = vec2(vSc.x, vh); vec3 q = sfSignBlock(vPar.x, mm, fz, 0.84); vec3 mk = sfMask(vPar.x, vec2(q.x, q.y)); if (stripes) c = mix(c, base, step(abs(q.x - 0.5), 0.52) * step(abs(q.y - 0.5), 0.75)); c = mix(c, fg, mk.r); }
    }
    if (zone < 0.5 && topText && vPar.x > -0.5) { vec2 fz = vec2(vSc.x, hyp * 0.62); vec3 q = sfSignBlock(vPar.x, vec2(mm.x, mm.y - hyp * 0.06), fz, 0.72); vec3 mk = sfMask(vPar.x, q.xy); c = mix(c, fg, max(mk.r, mk.g)); }
    float fade = sfH1(vec2(floor(vPar.w * 4096.0), 1.0));
    c = mix(c, vec3(dot(c, vec3(0.3333))) * 1.15 + 0.03, (zone < 0.5 ? 0.22 : 0.08) + 0.3 * fade);                    // the sun bleaches the top first
    float seam = smoothstep(0.012, 0.003, abs(fract(mm.x / 1.18 + 0.5) - 0.5) * 1.18); c *= 1.0 - 0.3 * seam * step(zone, 1.5);
    float weave = sfN(mm * vec2(310.0, 290.0)) * 0.5 + sfN(mm * 120.0) * 0.5; c *= 0.88 + 0.24 * weave;
    float run = sfFbm(vec2(mm.x * 5.0 + vPar.w * 9.0, mm.y * 0.5)); c *= 1.0 - 0.3 * smoothstep(0.5, 0.85, run) * (zone < 0.5 ? smoothstep(1.0, 0.2, uvl.y) : 1.0);      // dirt runs down to the front edge
    if (zone < 0.5) c *= 1.0 - 0.22 * smoothstep(0.25, 0.0, uvl.y);
    bump += vAl * (sin(mm.x * 6.283 / 1.18) * 0.10 + (sfN(mm * vec2(3.0, 9.0) + vPar.w) - 0.5) * 0.35) * step(zone, 1.5); bump.y += (sfN(mm * vec2(14.0, 3.0)) - 0.5) * 0.2;
    if (!gl_FrontFacing) emis = c * uSunColor * 0.22 * step(zone, 0.5) + c * 0.06;
    { vec2 ee = min(uvl, 1.0 - uvl) * (zone < 0.5 ? vec2(vSc.x, hyp) : (zone < 1.5 ? vec2(vSc.x, vh) : vec2(vSc.z, vSc.y))); c = mix(c, fg, 0.55 * smoothstep(0.03, 0.018, ee.x) * step(zone, 0.5)); }                                               // daylight through the cloth
    rough = 0.86; grime = 0.4;
  } else if (kind == 5) {                            // tile, terrazzo: x tile size
    float ts = vPar.x; vec2 g = m / ts; vec2 gf = fract(g); float j = smoothstep(0.006, 0.003, min(min(gf.x, 1.0 - gf.x), min(gf.y, 1.0 - gf.y)) * ts) * clamp(1.5 - fwidth(g.x) * 3.0, 0.0, 1.0);
    c *= 0.86 + 0.26 * sfH1(floor(g) + vPar.w * 17.0); if (vPar.y > 0.5) c = mix(c, vec3(0.03), mod(floor(g.x) + floor(g.y), 2.0) * 0.85); c = mix(c, vec3(0.16, 0.15, 0.14), j * 0.8); c *= 0.9 + 0.2 * n3; rough = 0.35 + 0.3 * n1;
  } else if (kind == 6) {                            // produce in crates, or cut flowers (x = 1): the top face; the sides are the stand
    if (vLN.y > 0.5) {
      float fl = vPar.x; float cs = fl > 0.5 ? 0.075 : 0.085; vec2 g = m / cs; vec2 id = floor(g); vec3 hh = sfH3(id + floor(vPar.w * 4096.0)); vec2 f = fract(g) - 0.5 - (hh.xy - 0.5) * 0.3; float d = length(f);
      float band = floor(m.x / 0.58 + vPar.w * 7.0); vec3 hb = sfH3(vec2(band, floor(vPar.w * 4096.0) + 2.0)); vec3 col;
      if (fl > 0.5) { col = hb.x < 0.2 ? vec3(0.75, 0.05, 0.10) : (hb.x < 0.4 ? vec3(0.85, 0.55, 0.05) : (hb.x < 0.6 ? vec3(0.80, 0.78, 0.72) : (hb.x < 0.8 ? vec3(0.75, 0.25, 0.45) : vec3(0.35, 0.12, 0.5)))); col = mix(col, vec3(0.05, 0.16, 0.04), step(0.55, hh.z)); col *= 0.7 + 0.6 * hh.y; }
      else { col = hb.x < 0.18 ? vec3(0.80, 0.33, 0.03) : (hb.x < 0.34 ? vec3(0.55, 0.04, 0.03) : (hb.x < 0.5 ? vec3(0.35, 0.50, 0.08) : (hb.x < 0.64 ? vec3(0.80, 0.62, 0.06) : (hb.x < 0.8 ? vec3(0.10, 0.28, 0.05) : vec3(0.60, 0.10, 0.04))))); col *= 0.82 + 0.3 * hh.y; }
      float ball = smoothstep(0.52, 0.40, d); c = mix(vec3(0.03, 0.025, 0.02), col * (1.15 - 1.1 * d * d * 2.0), ball); c += 0.10 * smoothstep(0.16, 0.05, length(f + vec2(0.12, -0.14))) * ball;
      float div = fl > 0.5 ? 0.0 : smoothstep(0.008, 0.02, abs(fract(m.x / 0.58 + vPar.w * 7.0) - 0.5) * 0.58 - 0.27); c = mix(c, vec3(0.30, 0.2, 0.1), div); rough = 0.5; if (fl < 0.5) bump += vec3(f.x, 0.0, f.y) * 1.2 * ball; grime = 0.0;
    } else { c *= 0.75 + 0.4 * sfN(m * vec2(3.0, 40.0)); rough = 0.8; }
  } else if (kind == 8) {                            // a bunch of flowers (the bouquet mesh): uv.x = leaf id + corner, uv.y = corner
    float id = floor(vUv0.x); vec2 cq = vec2(fract(vUv0.x) / 0.9, vUv0.y) - 0.5; vec3 hh = sfH3(vec2(id, floor(vPar.w * 4096.0)));
    bool bloom = vPar.y > hh.x;
    if (bloom) { if (length(cq) > 0.5) discard; c = mix(c, c.gbr, step(0.8, hh.y)) * (0.75 + 0.5 * hh.z) * (0.6 + 0.9 * (0.5 - length(cq))) ; c = mix(c, vec3(0.8, 0.6, 0.1), smoothstep(0.14, 0.08, length(cq)) * 0.7); }
    else { if (abs(cq.x) > 0.5 - abs(cq.y) * 0.9) discard; c = mix(vec3(0.02, 0.07, 0.015), vec3(0.07, 0.17, 0.04), hh.y) * (0.8 + 0.6 * (cq.y + 0.5)); }
    rough = 0.6; grime = 0.0; if (!gl_FrontFacing) emis = c * uSunColor * 0.08;
  } else if (kind == 7) {                            // wood
    float g = sfFbm(vec2(m.x * 34.0 + vPar.w * 5.0, m.y * 2.2)); c *= 0.72 + 0.5 * g; vec2 e = min(m, fs - m); float inset = min(e.x, e.y);
    float pan = smoothstep(0.012, 0.0, abs(inset - 0.11)) * step(0.6, fs.x) * step(1.2, fs.y); c *= 1.0 - 0.4 * pan; rough = 0.55;
  }
  // the street leaves its mark: splash and soot at the foot, streaks running down, dust on ledges
  float hgt = vWPos.y - 0.15; float base = smoothstep(0.6, 0.0, hgt) * (0.45 + 0.55 * n2) * grime;
  c *= 1.0 - 0.42 * base; c = mix(c, vec3(0.075, 0.07, 0.065), 0.28 * base);
  float streak = smoothstep(0.52, 0.9, sfFbm(vec2(wp.x * 3.3, wp.y * 0.16) + 3.0)); c *= 1.0 - 0.2 * streak * grime;
  rough = mix(rough, 0.9, 0.5 * base);
  sfAlb = c; sfRough = rough; sfMetal = metal; sfEmis = emis; sfBump = bump;
}`;

// ------------------------------------------------------------------------------------------------ shop glass
export const GLASS_VERT_PARS = /* glsl */`
attribute vec4 aG0; attribute vec4 aG1; attribute vec4 aG2; attribute vec4 aG3; attribute vec4 aG4; attribute vec4 aG5;
varying vec3 vS; varying vec3 vDirS; varying vec3 vWPos; varying vec4 vQ; varying vec4 vG0; varying vec4 vG1; varying vec4 vG2; varying vec4 vG3; varying vec4 vG4; varying vec4 vG5;`;
export const GLASS_VERT = /* glsl */`
{
  vec2 sz = vec2(1.0);
  #ifdef USE_INSTANCING
    sz = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz)); vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  #else
    vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
  #endif
  float cy = cos(aG0.w), sy = sin(aG0.w); vec3 q = vec3(position.x * sz.x, position.y * sz.y, 0.0);
  vS = aG0.xyz + vec3(cy * q.x, q.y, -sy * q.x);
  float ch = cos(aG1.w), sh = sin(aG1.w); vec3 dw = vWPos - cameraPosition;
  vDirS = vec3(dw.x * ch - dw.z * sh, dw.y, dw.x * sh + dw.z * ch);
  vQ = vec4((position.xy + 0.5) * sz, sz); vG0 = aG0; vG1 = aG1; vG2 = aG2; vG3 = aG3; vG4 = aG4; vG5 = aG5;
}`;
export const GLASS_FRAG_PARS = /* glsl */`
varying vec3 vS; varying vec3 vDirS; varying vec3 vWPos; varying vec4 vQ; varying vec4 vG0; varying vec4 vG1; varying vec4 vG2; varying vec4 vG3; varying vec4 vG4; varying vec4 vG5;
uniform sampler2D tMask; uniform sampler2D tRoom; uniform sampler2D tProp; uniform sampler2D tLight; uniform vec2 uHalf; uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter;
uniform vec4 uSf;      // x interior light, y mirror gain, z daylight into the room, w parked cars in the mirror (density)
` + SF_COMMON + /* glsl */`
const vec3 SF_AMB = vec3(0.40, 0.47, 0.58);
vec3 sfAmb(float sky){ return SF_AMB * (0.16 + 0.84 * clamp(sky, 0.0, 1.0)); }

// The street as the glass mirrors it: p, R in shop space (x along the wall, y up from the sidewalk, z out), pw, Rw the same in the world.
vec3 sfStreet(vec3 p, vec3 R, vec3 pw, vec3 Rw, vec3 sky, vec3 alW, vec3 outW){
  float oppD = vG3.x, oppH = vG3.y, kd = vG3.w; vec3 oppC = sfUnpack(vG3.z);
  float nl = max(dot(-outW, uSunDir), 0.0);
  if (R.z < 0.03) return vec3(0.035, 0.035, 0.04);
  // cars parked along our kerb
  float tc = (kd + 0.5 - p.z) / R.z; vec3 hc = p + R * tc; float yy = hc.y + 0.15;
  if (tc > 0.0 && yy > 0.0 && yy < 2.1 && (oppD <= 0.0 || kd + 6.0 < oppD)) {
    vec3 hw = pw + Rw * tc; float s = dot(hw, alW); float id = floor(s / 6.3); float cx = fract(s / 6.3) * 6.3; vec3 hh = sfH3(vec2(id, floor(dot(pw, outW) * 0.2) + 7.0));
    if (hh.x < uSf.w) {
      bool van = hh.y < 0.14; float top = van ? 1.95 : 1.46;
      bool body = cx > 0.75 && cx < 5.35 && yy > 0.24 && yy < 0.92;
      float ca = van ? 1.0 : 1.75 + (yy - 0.92) * 1.0, cb = van ? 5.3 : 4.75 - (yy - 0.92) * 0.7;
      bool cab = yy >= 0.92 && yy < top && cx > ca && cx < cb;
      bool wheel = length(vec2(cx - 1.6, yy - 0.34)) < 0.34 || length(vec2(cx - 4.5, yy - 0.34)) < 0.34;
      if (body || cab || wheel) {
        vec3 bk = sfBake(hw.xz); vec3 lightC = uSunColor * nl * bk.g + sfAmb(bk.r) * 0.6;
        vec3 pc = hh.z < 0.24 ? vec3(0.62) : (hh.z < 0.44 ? vec3(0.015) : (hh.z < 0.62 ? vec3(0.33, 0.34, 0.35) : (hh.z < 0.76 ? vec3(0.10, 0.105, 0.11) : (hh.z < 0.86 ? vec3(0.03, 0.06, 0.16) : (hh.z < 0.93 ? vec3(0.35, 0.03, 0.03) : vec3(0.75, 0.50, 0.02))))));
        if (wheel && !(body && yy > 0.62)) return vec3(0.012) * lightC + vec3(0.004);
        bool win = cab && !van && yy > 1.0 && yy < top - 0.09 && cx > ca + 0.13 && cx < cb - 0.13 && abs(cx - 3.1) > 0.05;
        if (win) return vec3(0.02, 0.025, 0.03) * lightC + sky * 0.05;
        float shade = 0.75 + 0.35 * smoothstep(0.3, 0.9, yy) - 0.25 * smoothstep(0.86, 0.92, yy) * step(yy, 0.92);
        return pc * lightC * shade + sky * 0.035 * smoothstep(0.7, 1.0, yy);
      }
    }
  }
  float far = oppD > 0.0 ? oppD : 1.0e4;
  if (R.y < -0.002) {
    float tg = -(p.y + 0.02) / R.y; vec3 hg = p + R * tg;
    if (hg.z < far) {
      vec3 hw = pw + Rw * tg; vec3 bk = sfBake(hw.xz); bool road = hg.z > kd && hg.z < far - 3.2;
      vec3 alb = road ? vec3(0.075, 0.075, 0.078) : vec3(0.27, 0.26, 0.245); alb *= 0.75 + 0.5 * sfN(hw.xz * 0.7); alb *= 1.0 - 0.5 * smoothstep(0.25, 0.0, abs(hg.z - kd));
      return alb * (uSunColor * max(uSunDir.y, 0.0) * bk.g + sfAmb(bk.r));
    }
  }
  if (oppD > 0.0) {
    float to = (oppD - p.z) / R.z; vec3 ho = p + R * to; vec3 hw = pw + Rw * to; float s = dot(hw, alW);
    float id = floor(s / 16.0 + 0.37); vec3 hb = sfH3(vec2(id, floor(oppD) + 3.0));
    float H = abs(ho.x) < 9.0 ? oppH : oppH * (0.45 + 1.0 * hb.x);
    if (ho.y < H) {
      vec3 bk = sfBake(hw.xz - outW.xz * 1.6); float vis = mix(bk.g, 1.0, 0.85 * smoothstep(0.0, max(H, 8.0), ho.y));
      vis = max(vis, smoothstep(2.0, 14.0, ho.y)); vec3 lightC = uSunColor * (nl * vis + 0.12) + sfAmb(max(bk.r, 0.6)) * 0.9;
      vec3 c = oppC * 1.15 * (0.75 + 0.5 * hb.y) * (0.85 + 0.3 * sfN(vec2(s * 0.4, ho.y * 0.4)));
      if (ho.y < 4.2) {
        vec3 hs = sfH3(vec2(floor(s / 6.5), 5.0)); c = vec3(0.03, 0.032, 0.035) + step(2.9, ho.y) * step(ho.y, 3.7) * hs * hs * 0.35 + step(ho.y, 2.7) * step(0.6, ho.y) * step(0.55, hs.z) * vec3(0.10, 0.085, 0.06);
        c = mix(c, oppC * 0.8, step(abs(fract(s / 6.5) - 0.5), 0.05));
      } else {
        float fl = (ho.y - 4.4) / 3.5; float wx = fract(s / 2.7 + hb.z), wy = fract(fl);
        if (wx > 0.22 && wx < 0.78 && wy > 0.2 && wy < 0.72) c = vec3(0.05, 0.055, 0.06) + sky * 0.09 * step(0.3, sfH1(vec2(floor(s / 2.7 + hb.z), floor(fl))));
      }
      return c * lightC;
    }
  } else {
    float to = (36.0 - p.z) / R.z; vec3 ho = p + R * to; vec3 hw = pw + Rw * to; float s = dot(hw, alW);
    float ht = 7.0 + 3.0 * sfN(vec2(s * 0.05, 1.0)) + 3.2 * sqrt(abs(sin(s * 0.42 + 2.0 * sfN(vec2(s * 0.11, 9.0))))) + 0.9 * sfN(vec2(s * 2.3, ho.y * 1.5)) + 0.5 * sfN(vec2(s * 7.0, ho.y * 5.0));
    if (ho.y < ht) { vec3 bk = sfBake(hw.xz); float n = sfFbm(vec2(s, ho.y) * 0.9); vec3 g = mix(vec3(0.015, 0.028, 0.010), vec3(0.060, 0.090, 0.028), n);
      if (ho.y < 2.2) g = mix(g, vec3(0.05, 0.045, 0.04), 0.7); return g * (uSunColor * (0.25 + 0.5 * n) * mix(bk.g, 1.0, 0.6) + sfAmb(bk.r)); }
  }
  return sky;
}

vec3 sfBack(float u, float v){ float cell = vG5.x; return texture2D(tRoom, vec2((mod(cell, 2.0) + clamp(u, 0.003, 0.997)) * 0.5, 1.0 - (floor(cell / 2.0) + 1.0 - clamp(v, 0.012, 0.988)) * 0.125), 0.9).rgb; }
vec4 sfSprite(float row, vec2 xy, float y0, float salt, float dens, float Hr, out float em){
  float xs = xy.x / 1.3 + vG2.y * 17.0 + salt * 0.37; float i = floor(xs); float u = fract(xs);
  vec3 h = sfH3(vec2(i + salt * 31.0, floor(vG2.y * 4096.0) + row)); em = 0.0;
  if (h.x > dens) return vec4(0.0);
  float col = floor(h.y * 6.999);
  if (salt < 0.5 && h.z > 0.88 && row > 0.5 && row < 3.5) { col = 7.0; em = 1.0; }
  else if (row < 0.5 && h.z > 0.93) col = 7.0;
  bool hang = (row > 0.5 && row < 1.5 && col > 3.5 && col < 4.5) || (row > 3.5 && col > 4.5 && col < 5.5);
  float v = hang ? 1.0 - (Hr - xy.y) / 1.95 : (xy.y - y0) / 1.95;
  if (v < 0.0 || v > 1.0) return vec4(0.0);
  if (h.z < 0.45 && col < 6.5) u = 1.0 - u;
  return texture2D(tProp, vec2((col + clamp(u, 0.03, 0.97)) / 8.0, 1.0 - (row + 1.0 - clamp(v, 0.008, 0.992)) * 0.1875), 0.6);
}
vec3 sfSunIn(vec3 h, vec3 n, vec3 sunL, float sunVis){
  float W = vG1.x, zF = vG4.y;
  if (sunL.z > 0.05 && sunVis > 0.01) { float ts = (zF - h.z) / sunL.z; vec3 q = h + sunL * ts; if (abs(q.x) < W * 0.5 && q.y > vG4.z && q.y < vG4.w) return uSunColor * max(dot(n, sunL), 0.0) * sunVis * 0.8; }
  return vec3(0.0);
}
// The room behind the glass: a box of the shop's width, lit from its ceiling, with two rows of things standing in it and a window display.
vec3 sfInterior(vec3 p, vec3 d, float sunVis, vec3 sunL, vec3 dayC, vec3 Lout){
  float W = vG1.x, Hr = vG1.y, D = vG1.z, zF = vG4.y, bk = vG4.z, seed = vG2.y; float lit = vG2.z; float fk = mod(vG5.y, 10.0), warm = floor(vG5.y / 10.0);
  float flags = vG2.w; bool front = mod(flags, 2.0) > 0.5, paper = mod(floor(flags / 2.0), 2.0) > 0.5;
  vec3 Lw = mix(vec3(0.90, 0.96, 1.0), vec3(1.0, 0.82, 0.60), warm) * lit * uSf.x;
  if (paper && front) { float seam = smoothstep(0.02, 0.0, abs(fract(p.x / 0.9 + seed) - 0.5) - 0.48); return vec3(0.42, 0.33, 0.21) * (0.75 + 0.35 * sfFbm(p.xy * 2.0 + seed * 9.0)) * (1.0 - 0.3 * seam) * (Lout * 0.75 + Lw * 0.2); }
  vec3 dd = vec3(abs(d.x) < 1e-4 ? 1e-4 : d.x, abs(d.y) < 1e-4 ? 1e-4 : d.y, d.z);
  float tx = ((dd.x > 0.0 ? W * 0.5 : -W * 0.5) - p.x) / dd.x, ty = ((dd.y > 0.0 ? Hr : 0.0) - p.y) / dd.y, tz = dd.z < -1e-4 ? (-D - p.z) / dd.z : 1.0e9;
  if (dd.z >= -1e-4 && (zF - p.z) / max(dd.z, 1e-4) < min(tx, ty)) return dayC * 1.6;
  float t = max(min(tx, min(ty, tz)), 0.0); vec3 h = p + dd * t; vec3 n, alb, em = vec3(0.0); float depth = zF - h.z;
  if (t == tz) { n = vec3(0.0, 0.0, 1.0); alb = sfBack(fract(h.x / (Hr * 4.0) + seed * 7.3), h.y / Hr) * 0.8; }
  else if (t == tx) { n = vec3(-sign(dd.x), 0.0, 0.0); alb = sfBack(fract(depth / (Hr * 4.0) + 0.37 + seed), h.y / Hr) * 0.72; }
  else if (dd.y > 0.0) {
    n = vec3(0.0, -1.0, 0.0); alb = lit < 0.7 ? vec3(0.07, 0.065, 0.06) : vec3(0.50, 0.49, 0.47) * (0.8 + 0.2 * sfN(vec2(h.x, depth) * 1.7));
    vec2 f = fract(vec2(h.x / 1.25 + seed, depth / 1.6 + 0.3));
    if (mod(fk, 2.0) < 0.5) { if (abs(f.x - 0.5) < 0.11 && abs(f.y - 0.5) < 0.38) em = Lw * 2.6; } else if (length((f - 0.5) * vec2(1.25, 1.6)) < 0.085) em = Lw * 5.0;
    float duct = step(0.86, sfH1(vec2(floor(depth / 1.6 + 0.3), floor(seed * 4096.0)))); alb *= 1.0 - 0.3 * duct;
  } else {
    n = vec3(0.0, 1.0, 0.0); vec2 q = vec2(h.x, depth); vec3 hs = sfH3(vec2(floor(seed * 4096.0), fk));
    if (fk < 0.5) { float ck = mod(floor(q.x / 0.3) + floor(q.y / 0.3), 2.0); alb = mix(mix(vec3(0.50, 0.48, 0.44), vec3(0.42, 0.20, 0.14), step(0.6, hs.x)), vec3(0.07, 0.07, 0.075), ck * step(hs.y, 0.7)); }
    else if (fk < 1.5) { float pl = floor(q.x / 0.14); alb = mix(vec3(0.30, 0.18, 0.09), vec3(0.16, 0.10, 0.06), hs.x) * (0.75 + 0.5 * sfH1(vec2(pl, floor(q.y / 1.3 + sfH1(vec2(pl, 3.0)))))); }
    else if (fk < 2.5) { vec2 g = fract(q / 0.6); alb = vec3(0.46, 0.44, 0.40) * (0.85 + 0.25 * sfH1(floor(q / 0.6))) * (1.0 - 0.4 * step(min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y)), 0.015)); em = Lw * 0.10; }
    else if (fk < 3.5) alb = vec3(0.36, 0.37, 0.38) * (0.85 + 0.3 * sfN(q * 9.0));
    else alb = mix(vec3(0.07, 0.065, 0.08), vec3(0.16, 0.05, 0.05), step(0.5, hs.x)) * (0.8 + 0.4 * sfN(q * 30.0));
  }
  vec3 E = Lw * (0.5 + 0.5 * smoothstep(0.0, Hr, h.y)) + dayC * exp(-depth * 0.55) * (0.6 + 0.4 * n.z) + sfSunIn(h, n, sunL, sunVis);
  E *= 0.55 + 0.45 * exp(-depth * 0.16); if (n.y < 0.5 && n.y > -0.5) E *= 0.55 + 0.45 * smoothstep(0.0, 0.5, h.y); else if (n.y > 0.5) E *= 0.6 + 0.4 * smoothstep(0.0, 0.6, min(W * 0.5 - abs(h.x), D + h.z));
  vec3 col = alb * E + em;
  if (dd.z < -1e-4) {
    float mr = floor(vG4.x / 8.0), fr = mod(vG4.x, 8.0); float dens = lit < 0.2 ? 0.0 : 1.0;
    for (int k = 0; k < 3; k++) {
      float zk = k == 0 ? zF - min(D * 0.62, 4.3) : (k == 1 ? zF - 1.9 - seed : zF - 0.5);
      float tk = (zk - p.z) / dd.z; if (tk <= 0.0 || tk >= t) continue;
      vec3 hk = p + dd * tk; float em2; float y0 = k == 2 ? max(0.0, bk - 0.22) : 0.0;
      vec3 Ek = Lw * 0.62 + dayC * exp(-(zF - zk) * 0.55) + sfSunIn(hk, vec3(0.0, 0.0, 1.0), sunL, sunVis);
      if (k == 2 && bk > 0.26 && hk.y < y0) { col = vec3(0.20, 0.19, 0.17) * (dayC * 0.5 + Lw * 0.3); continue; }
      vec4 s = sfSprite(k == 2 ? fr : mr, hk.xy, y0, float(2 - k), (k == 2 ? 0.68 : 0.6) * dens, Hr, em2);
      bool glow = em2 > 0.5 || (k < 2 && mr > 0.5 && mr < 1.5 && false);
      col = col * (1.0 - s.a) + s.rgb * (glow ? vec3(2.4 * max(lit, 0.6)) : Ek);
    }
  }
  // paper signs taped inside the glass
  float clutter = vG5.z;
  if (front && clutter > 0.01) {
    vec2 g = vec2(p.x / 0.46 + seed * 5.0, (p.y - bk - 0.1) / 0.6); vec2 id = floor(g), f = fract(g); vec3 hp = sfH3(id + floor(seed * 4096.0));
    if (g.y > 0.0 && g.y < 3.0 && hp.x < clutter * 0.3 && f.x > 0.06 + 0.25 * hp.z && f.x < 0.94 - 0.2 * hp.y && f.y > 0.08 + 0.3 * hp.y && f.y < 0.92 - 0.25 * hp.z) {
      vec3 pc = hp.y < 0.5 ? vec3(0.70, 0.69, 0.64) : (hp.y < 0.64 ? vec3(0.70, 0.55, 0.10) : (hp.y < 0.76 ? vec3(0.50, 0.07, 0.06) : (hp.y < 0.88 ? vec3(0.45, 0.55, 0.40) : vec3(0.10, 0.20, 0.42)))); pc *= 0.8 + 0.3 * sfN(p.xy * 9.0);
      float row = floor(f.y * 9.0); float bar = step(0.45, fract(f.y * 9.0)) * step(f.x, 0.2 + 0.65 * sfH1(vec2(row, id.x + id.y * 7.0))) * step(0.16, f.x);
      vec3 ink = hp.y < 0.64 ? pc * 0.25 : mix(pc, vec3(0.8), 0.75); float big = step(6.0, row) * step(abs(f.x - 0.5), 0.3);
      col = mix(pc, ink, max(bar * step(row, 5.5), big * step(0.3, fract(f.x * 5.0 + hp.z)) * 0.9)) * (Lout * 0.8 + Lw * 0.15);
    }
  }
  col = mix(vec3(dot(col, vec3(0.3333))), col, 0.86);
  return col;
}`;

// runs after the lights (in place of the ao chunk): takes the sun's shadow from the lit result, then writes the whole pane as emission
export const GLASS_FRAG_MAIN = /* glsl */`
{
  float hd = vG1.w; vec3 alW = vec3(cos(hd), 0.0, -sin(hd)), outW = vec3(sin(hd), 0.0, cos(hd));
  float yw = vG0.w; vec3 nS = vec3(sin(yw), 0.0, cos(yw));
  float seed = vG2.y; float sI = floor(vG2.y * 4096.0); float flags = vG2.w; bool front = mod(flags, 2.0) > 0.5, door = mod(floor(flags / 4.0), 2.0) > 0.5, transom = mod(floor(flags / 8.0), 2.0) > 0.5;
  // each pane of plate glass sits a hair off true, so the mirrored street breaks at the mullions
  float pane = floor(vQ.x / 1.7 * max(1.0, floor(vQ.z / 1.7 + 0.5)) / max(vQ.z / 1.7, 0.01)); vec3 pj = sfH3(vec2(pane + sI, floor(vG0.x * 31.0) + 3.0));
  vec3 nJ = normalize(nS + vec3((pj.x - 0.5) * 0.014 * cos(yw), (pj.y - 0.5) * 0.014, 0.0) + vec3(sfN(vS.xy * 0.9 + seed) - 0.5, sfN(vS.yx * 0.9 + 7.0) - 0.5, 0.0) * 0.006);
  vec3 Nw = normalize(alW * nJ.x + vec3(0.0, nJ.y, 0.0) + outW * nJ.z);
  vec3 Vw = normalize(vWPos - cameraPosition); vec3 Rw = reflect(Vw, Nw); vec3 R = vec3(dot(Rw, alW), Rw.y, dot(Rw, outW));
  float cosi = max(dot(-Vw, Nw), 0.0); float F = min(1.0, (0.085 + 0.915 * pow(1.0 - cosi, 5.0)) * uSf.y);
  float ndl = max(dot(Nw, uSunDir), 0.0);
  float sh = ndl > 0.03 ? clamp(reflectedLight.directDiffuse.g / (uSunColor.g * ndl), 0.0, 1.0) : 0.0;
  vec3 bkh = sfBake(vWPos.xz + outW.xz * 1.1);
  float bFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz)); float sunVis = mix(sh, bkh.g * step(0.03, ndl), bFar);
  vec3 sky = vec3(0.5, 0.6, 0.75);
  #ifdef USE_ENVMAP
    sky = getIBLRadiance(geometryViewDir, normalize((viewMatrix * vec4(Nw, 0.0)).xyz), 0.0) / max(envMapIntensity, 1e-3);
  #endif
  vec3 refl = sfStreet(vS, R, vWPos, Rw, sky, alW, outW);
  vec3 amb = sfAmb(bkh.r); vec3 Lout = uSunColor * ndl * sunVis + amb * 0.75;
  vec3 dayC = (amb * 0.8 + uSunColor * 0.10 * bkh.g) * uSf.z;
  vec3 sunL = vec3(dot(uSunDir, alW), uSunDir.y, dot(uSunDir, outW));
  vec3 inner = sfInterior(vS, normalize(vDirS), sunVis, sunL, dayC, Lout);
  float dist = length(vWPos - cameraPosition); float farK = smoothstep(9.0, 40.0, dist); F = min(1.0, F * (1.0 + 0.9 * farK)); inner = mix(inner, inner * 0.8 + mix(vec3(0.030, 0.034, 0.038), vec3(0.055, 0.042, 0.028), floor(vG5.y / 10.0)) * vG2.z, farK);
  vec3 col = inner * (1.0 - F) * vec3(0.84, 0.89, 0.86) + refl * F;
  // vinyl lettering on the glass
  float tag = vG5.w; float dm = 0.0; vec3 dc = vec3(0.82);
  if (front && tag > 0.5) { float hh = tag < 199.5 ? 0.42 : 0.105; float ww = hh * sfAspect(tag); float yc = tag < 199.5 ? vQ.w * 0.55 : (sfH1(vec2(sI, 2.0)) < 0.5 ? 0.24 : vQ.w - 0.26);
    float xc = vQ.z * 0.5; float sc = min(1.0, vQ.z * 0.9 / ww); dm = sfMask(tag, vec2((vQ.x - xc) / (ww * sc) + 0.5, (vQ.y - yc) / (hh * sc) + 0.5)).r; dm = max(dm, sfMask(tag, vec2((vQ.x - xc) / (ww * sc) + 0.5, (vQ.y - yc) / (hh * sc) + 0.5)).g); }
  if (door) { float cell = 116.0 + floor(sfH1(vec2(sI, 9.0)) * 2.99); vec3 mk = sfMask(cell, vec2((vQ.x - vQ.z * 0.5) / 0.30 + 0.5, (vQ.y - vQ.w * 0.66) / 0.30 + 0.5)); dm = max(dm, max(mk.r, mk.g)); }
  if (transom) { float cell = 120.0 + floor(sfH1(vec2(sI, 4.0)) * 7.99); float hh = min(vQ.w * 0.8, 0.34); dm = max(dm, sfMask(cell, vec2((vQ.x - vQ.z * 0.5) / hh + 0.5, (vQ.y - vQ.w * 0.5) / hh + 0.5)).r); dc = vec3(0.78, 0.62, 0.30); }
  col = mix(col, dc * Lout, dm * 0.92);
  // the film of city dust, thicker at the foot where the pavement splashes
  float dust = 0.035 + 0.09 * sfFbm(vS.xy * vec2(1.3, 0.6) + seed * 13.0) + 0.22 * smoothstep(0.55, 0.0, vQ.y) * (0.4 + 0.6 * sfN(vS.xy * vec2(9.0, 3.0))) + 0.05 * smoothstep(0.75, 0.9, sfFbm(vS.xy * vec2(0.8, 4.0) + 3.0));
  col = mix(col, vec3(0.42, 0.40, 0.36) * Lout, clamp(dust, 0.0, 1.0) * 0.55);
  reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0); reflectedLight.directSpecular *= 0.5;
  totalEmissiveRadiance = col;
}`;
