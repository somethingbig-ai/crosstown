// facade.js: the building material. One MeshStandardMaterial whose shader draws, from the wall's metre UVs and a per-building
// style/seed, the masonry, the windows (recessed, with rooms behind the glass), storefronts with signs, cornices and roofs.
// Lighting uses the Cycles bake carried in the vertex colour: r = sky light, g = sun visibility (far field), b = bounced sunlight.
import * as THREE from 'three';
const REALREFL = (() => { try { const v = new URLSearchParams(location.search).get('realrefl'); return v === null ? 0 : +v; } catch (e) { return 0; } })();     // off until a blind round says it wins: ?realrefl=0.8 to see it

export const SHOP_NAMES = ['DELI & GRILL', 'PIZZA', 'NAILS', 'LAUNDROMAT', 'HARDWARE', 'COFFEE', 'FLOWERS', 'BAGELS', 'TAILOR', 'BOOKS', 'WINE & SPIRITS', 'CLEANERS',
  'BARBER SHOP', 'GOURMET MARKET', 'NOODLES', 'SHOE REPAIR', 'PHARMACY', 'LOCKSMITH', 'DINER', 'RECORDS', 'OPTICAL', 'JUICE BAR', 'TACOS', 'ELECTRONICS',
  'LUGGAGE', 'FABRICS', 'WHOLESALE', 'PERFUME', 'JEWELRY', 'GIFTS', 'CAMERA', 'BAKERY'];

export function makeSignAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 2048; const g = c.getContext('2d');
  const pal = [['#16233f', '#f2efe6'], ['#7a1414', '#fff3d6'], ['#f1ede2', '#1c1c1c'], ['#0f3d2a', '#f4e9c8'], ['#111111', '#e9c46a'], ['#f4d03f', '#1b1b1b'], ['#2b2b2b', '#ffffff'], ['#5a2d0c', '#ffe8c2'],
    ['#e9e4d8', '#8a1c1c'], ['#143a5a', '#ffffff'], ['#3b0f3b', '#f6e7ff'], ['#d9d4c7', '#143a5a']];
  const fonts = ['bold 44px Helvetica, Arial, sans-serif', 'bold 46px Georgia, serif', '600 42px "Gill Sans", "Trebuchet MS", sans-serif', 'bold 44px "Courier New", monospace', 'italic bold 46px Georgia, serif', '800 48px Impact, "Arial Narrow", sans-serif'];
  for (let i = 0; i < 32; i++) {
    const y = i * 64, [bg, fg] = pal[(i * 5 + 3) % pal.length];
    g.fillStyle = bg; g.fillRect(0, y, 1024, 64);
    g.fillStyle = fg; g.font = fonts[(i * 7) % fonts.length]; g.textAlign = 'center'; g.textBaseline = 'middle';
    const t = SHOP_NAMES[i]; let w = g.measureText(t).width; g.save(); g.translate(512, y + 34); if (w > 940) g.scale(940 / w, 1); g.fillText(t, 0, 0); g.restore();
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, 1024, 2); g.fillRect(0, y + 62, 1024, 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export const NOISE_GLSL = /* glsl */`
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), f.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03+17.1; a *= .5; } return s; }
`;

// Shared lighting hook: bake (sky, sunvis, bounce) -> three's reflectedLight. `bakeV` must be set before this runs.
export const BAKE_LIGHT_GLSL = /* glsl */`
  {
    float bSky = clamp(bakeV.r / (0.5 + 0.5 * bakeN.y), 0.0, 1.15);
    float bFar = smoothstep(uShadowFar * 0.72, uShadowFar * 0.95, length(vWPos.xz - uShadowCenter.xz));
    float bVis = mix(1.0, bakeV.g, bFar);
    reflectedLight.directDiffuse *= bVis; reflectedLight.directSpecular *= bVis;
    // reflections: where the mirrored ray would hit the street canyon rather than the sky, show a dim city colour instead
    vec3 bR = reflect(-normalize(cameraPosition - vWPos), bakeN);
    float open = smoothstep((1.0 - bSky) * 0.95 - 0.25, (1.0 - bSky) * 0.95 + 0.15, bR.y);
    reflectedLight.indirectSpecular *= mix(0.22, 1.0, open) * mix(0.55, 1.0, bSky);
    reflectedLight.indirectDiffuse *= (0.16 + 0.84 * bSky);
    reflectedLight.indirectDiffuse += bakeV.b * 0.3 * uSunColor * vec3(1.0, 0.93, 0.84) * material.diffuseColor;   // sunlight bounced off the city (irradiance/pi folded into uSunColor scale)
  }
`;

// the window itself (frame, sash, rails, room, blinds, each light's tilt and bow, dust): shared by the drawn windows and the photographed fronts.
// Needs in scope: wc (metres from the opening's centre, on the glass plane), half_, style, ribbon, bi, half_id, fi and the building's hashes.
const WIN_BODY = /* glsl */`
              float fb = half_.x > 0.72 ? 0.135 : 0.12;   // frame and sash stile together
              float ap = fPx * 0.6;      // edges a pixel soft: thin bars fade to their coverage instead of breaking up
              bool ySp = style < 2.5 || pairS > 0.5;
              float wk = pairS > 0.5 ? 1.0 : (style > 3.5 ? 3.0 : (style > 2.5 ? (ribbon > 0.5 ? 4.0 : 2.0) : 0.0));
              // glass34: the window has real depth. The ray is followed through it: casing and upper sash stand 75 mm in front of the lower sash's glass, the upper glass 50 mm,
              // the lower sash 40 mm; where the ray misses a member's face but meets its footprint further in, it has hit that member's side (its return). wc ends as the point on the glass.
              vec2 parW = clamp(par, -2.5, 2.5); float zU = 0.075, zG = ySp ? 0.05 : 0.0, zL = 0.04;
              vec2 wcl = wc; vec2 pF = wc + parW * zU; float lF, lG, mL = 0.0, sideL = 0.0;
              float mU = winFr(pF, half_, fb, wk, ap, lF);
              vec2 pUG = wc + parW * zG; bool upH = ySp && pUG.y > 0.02; if (upH) wc = pUG;
              float mG = winFr(wc, half_, fb, wk, ap, lG); float sideU = max(mG - mU, 0.0);
              if (ySp && !upH) { winFr(wc + parW * zL, half_, fb, wk, ap, mL); sideL = max(lG - mL, 0.0); }
              float fr = max(max(mU, mL), max(sideU, sideL));
              vec3 sideN = vec3(0.0, sign(parW.y), 0.2);
              if ((1.0 - mU) * (1.0 - mL) * max(sideU, sideL) > 0.01) { float l2; float m2 = winFr(vec2(pF.x, wc.y), half_, fb, wk, ap, l2); if (max(m2, l2) < 0.5) sideN = vec3(sign(parW.x), 0.0, 0.2); }
              float fsh = 1.0;      // the sun's ray from the glass (or the lower sash) must clear the members in front of it
              if (st3.z > 0.02) { float l3; fsh = 1.0 - 0.9 * winFr(wc + clamp(spar, -3.0, 3.0) * (zU - (upH ? zG : 0.0)), half_, fb, wk, ap * 2.0 + 0.004, l3); }
              vec2 id = vec2(bi * 2.0 + half_id, fi) + floor(seed * 512.0) * vec2(3.0, 1.0); float hsh = hash21(id);
              bool office = style > 2.5 || (style > 0.5 && (bigWin > 0.5 || H > 40.0));
              float lit = step(office ? 0.86 : 0.93, hash21(id + 5.0));
              vec3 d = normalize(vec3(-par, 1.0));
              vec3 room = roomColor(wc, d, half_ * 2.0, 4.5, id, lit) * (1.0 + 1.2 * lit);
              // the building's glass and its tenants' habits
              vec3 gT = h3.x < 0.4 ? vec3(0.78, 0.82, 0.80) : (h3.x < 0.75 ? vec3(0.50, 0.66, 0.62) : vec3(0.52, 0.55, 0.57));
              if (style > 2.5 && style < 3.5 && h4.x > 0.6) gT = vec3(0.56, 0.47, 0.36);
              vec3 bcol = h4.z < 0.5 ? vec3(0.80, 0.79, 0.75) : (h4.z < 0.75 ? vec3(0.78, 0.72, 0.60) : (h4.z < 0.9 ? vec3(0.52, 0.52, 0.50) : vec3(0.42, 0.36, 0.30)));
              float habit = mix(0.5, 0.85, h4.x); if (fFlat > 0.5) habit = 0.92;
              // blinds / shades / curtains just behind the glass; a loft's three lights each have their own
              vec2 bid = id, bp = wc, bh = half_;
              if (style > 3.5) { float li = step(-half_.x * 0.36, wc.x) + step(half_.x * 0.36, wc.x); bid += li * 17.0; bh.x = li == 1.0 ? half_.x * 0.36 : half_.x * 0.32; bp.x = wc.x - (li - 1.0) * half_.x * 0.68; }
              bp -= parW * 0.07; vec4 bc = blindColor(bp, bh, bid, habit, h4.y, bcol, fPx);
              room = room * (1.0 - bc.a) + bc.rgb * bc.a * lit * 0.06;
              fPane = bc.rgb * bc.a * mix(vec3(1.0), gT, 0.7) * (st3.z > 0.02 ? 0.62 : 0.45) * (1.0 - 0.3 * fFlat) * (1.0 - 0.08 * fFlat * (0.5 + 0.5 * sin(bp.y * 52.0)) * smoothstep(0.03, 0.008, fPx)) * (1.0 - 0.25 * fFlat * smoothstep(0.35, 0.75, vnoise(bp * vec2(1.6, 4.0) + bid)));      // glass60: on flats a shade is a mid-tone cloth with bands and blotches (lit white it read as a blank card)
              // an air conditioner in some of the old sash windows
              bool acHere = (style < 0.5 && !secondary) ? mod(bi * 7.0 + fi * 13.0 + floor(seed * 512.0) * 3.0, 11.0) < 1.5 : (secondary && hsh > 0.84);
              if (acHere && wc.y < -half_.y + 0.42 && abs(wc.x) < 0.33) { fAlb = vec3(0.55, 0.54, 0.5) * (0.6 + 0.4 * step(0.5, fract(wc.y * 30.0))); fRough = 0.7; return; }
              alb = room; rough = 0.07; fGlass = 1.0; fGT = gT; fF0 = office ? 0.20 + 0.08 * h4.y : 0.16 + 0.07 * h4.y;

              { float lx = style > 3.5 ? step(-half_.x * 0.36, wc.x) + step(half_.x * 0.36, wc.x) : (style > 2.5 ? step(0.0, wc.x) : 0.0);
                vec2 pid = id * 1.7 + vec2((ySp ? step(0.0, wc.y - 0.02) * 13.0 : 0.0) + lx * 5.0, 3.0 + lx * 7.0); vec3 pj = hash32(pid);
                float old = (style < 1.5 || style > 3.5) ? 1.0 : 0.3;
                // each light sits a little off true; old drawn glass ripples, sealed units bow
                vec2 wav = vec2(vnoise(vec2(wc.x * 5.0, wc.y * 0.9) + pid) - 0.5, vnoise(vec2(wc.x * 1.2, wc.y * 3.6) + pid + 9.0) - 0.5) * smoothstep(0.3, 0.06, fPx) / (1.0 + 0.8 * dot(par, par));
                // every light is its own sheet: set a little off true, and bowed like a pillow (slope greatest at mid-edge), so each mirrors the street its own way
                vec2 ls = wc / half_; if (ySp) ls.y = (wc.y - sign(wc.y - 0.02) * half_.y * 0.5) / (half_.y * 0.5); if (style > 2.5 && style < 3.5) ls.x = (wc.x - sign(wc.x) * half_.x * 0.5) / (half_.x * 0.5); ls = clamp(ls + (pj.yx - 0.5) * 0.9, -1.4, 1.4) * 1.2;      // the belly of the bow is never dead centre
                vec2 bowv = (vec2(sin(ls.x) * cos(ls.y), cos(ls.x) * sin(ls.y)) + (vec2(vnoise(wc * 1.7 + pid * 5.0), vnoise(wc * 1.7 + pid * 5.0 + 31.0)) - 0.5) * 0.25) * (pj.z - 0.4) * 0.008;
                fNrmT = normalize(vec3((hash32(id * 1.7 + 3.0).xy - 0.5) * vec2(0.05, 0.06) + (pj.xy - 0.5) * vec2(0.028, 0.031) + vec2(0.0, ySp ? (upH ? 0.012 : -0.009) : 0.0) + wav * vec2(0.004, 0.003) * (0.45 + 0.55 * old) + bowv, 1.0));
                { float sxs = pairS > 0.5 ? step(0.0, wc.x) : 0.0; float rh = hash21(id + sxs * 3.0); if (rh > 0.55 && rh < 0.59 && !upH && wc.y < -0.03 && (style < 1.5 || pairS > 0.5)) { alb = room * 0.6; fGlass = 0.12; fPane = vec3(0.0); } }      // a raised lower sash: open, no pane to reflect
                alb *= 0.55 + 0.9 * hash21(id + 11.0); fRefl = (0.4 + 0.35 * pj.z) * (0.6 + 0.5 * hash21(id + 61.0)) * (0.78 + 0.22 * smoothstep(0.0, 0.35, half_.y - wc.y)) * (1.0 - 0.55 * bc.a * fFlat);
                // dust and rain marks: a pale film that the sun lights, thickest in the lower corners
                float lyT = (ySp && wc.y < 0.02) ? 0.02 - wc.y : half_.y - wc.y; float lyB = (ySp && wc.y > 0.02) ? wc.y - 0.02 : wc.y + half_.y; float lxE = half_.x - abs(wc.x); if (wk > 0.5 && wk < 1.5) lxE = min(lxE, abs(wc.x));      // metres below the top of this light, above its foot, from its side
                float runs = smoothstep(0.55, 0.9, vnoise(vec2(wc.x * 46.0, wc.y * 1.3) + pid * 3.0)) * exp(-lyT * (1.2 + 3.0 * pj.x)) + 0.6 * smoothstep(0.6, 0.9, vnoise(vec2(wc.x * 21.0, wc.y * 0.6) + pid * 7.0)) * smoothstep(0.1, 0.9, vnoise(wc * vec2(1.3, 0.9) + pid));      // rain runs from the head and the meeting rail
                float crn = smoothstep(0.30, 0.0, lyB + lxE * 0.9 + 0.10 * vnoise(wc * 9.0 + pid)) + 0.5 * smoothstep(0.07, 0.0, min(lyB, lxE)) + 0.3 * smoothstep(0.05, 0.0, lyT);      // dust banked in the lower corners and along the putty
                float dirt = (0.012 + 0.05 * smoothstep(0.4, 0.85, vnoise(wc * vec2(2.3, 1.1) + id * 3.0)) + 0.11 * runs + 0.16 * crn) * (0.5 + 1.3 * h4.y) * (0.5 + 1.1 * hash21(pid + 31.0)) * (st3.z > 0.02 ? 0.7 : 0.45);
                fPane += vec3(0.40, 0.38, 0.34) * dirt; fDirt = dirt;
                fVeil = 0.02 + 0.10 * smoothstep(-half_.y, half_.y, wc.y) * pj.z + 0.08 * smoothstep(0.5, 0.9, vnoise(wc * vec2(0.9, 1.6) + pid)); }      // the sheen of the sky on the sheet itself, stronger to the head
              if (ySp && wc.y < 0.0) { float msh = 1.0 - 0.55 * smoothstep(-0.16, -0.03, wc.y); alb *= msh; fPane *= msh; fRefl *= 0.35 + 0.65 * msh; }
              vec3 frc = frameCol * (0.95 + 0.55 * hash21(id + 23.0)) * (0.92 + 0.16 * vnoise(wcl * vec2(2.0, 2.6) + id * 5.0)); frc = mix(frc, vec3(0.20, 0.19, 0.17), 0.10 * smoothstep(0.4, 0.9, vnoise(wcl * vec2(37.0, 41.0) + id * 3.0)) * smoothstep(0.03, 0.01, fPx)) * (1.0 - 0.3 * smoothstep(0.5, 0.0, wcl.y + half_.y));      // chalked, worn paint in patches; grime gathers low
              { float deF = min(half_.x - abs(pF.x), half_.y - abs(pF.y)); float sdx = st3.x >= 0.0 ? 1.0 : -1.0;
                frc *= 1.0 - 0.7 * AAL(abs(deF - 0.074), 0.007, ap) * mU * smoothstep(0.035, 0.012, fPx);      // the dark joint where the sash meets the casing
                float cas = step(deF, 0.07); vec3 casC = h3.z < 0.6 ? frc * 1.7 : vec3(0.15, 0.10, 0.08); casC *= mix(0.3, 1.0, smoothstep(0.0, 0.012 + 1.5 * fPx, min(half_.x - abs(wcl.x), half_.y - abs(wcl.y))));      // the casing is painted with the trim, the sash is its own colour; where it meets the masonry it is in the joint's shade (a pale casing against the hard reveal edge drew a stair-stepped white line)      // casing, upper sash and lower sash are three pieces of joinery: each its own tone, its upper arris catching the sky
                float hl = 0.0, hd = 0.0; if (fPx < 0.035 && max(mU, mL) > 0.5) { vec2 lo = vec2(0.0, 0.022); float nf = smoothstep(0.035, 0.015, fPx); float l4; float m4 = winFr((mU > 0.5 ? pF : wc + parW * zL) + lo, half_, fb, wk, ap, l4); hl = (1.0 - (mU > 0.5 ? m4 : l4)) * nf; float l5; float m5 = winFr((mU > 0.5 ? pF : wc + parW * zL) - lo, half_, fb, wk, ap, l5); hd = (1.0 - (mU > 0.5 ? m5 : l5)) * nf; }      // every member has a lit arris (up and to the sun) and a shaded one
                float ush = (ySp && !upH) ? 1.0 - 0.55 * smoothstep(-0.14, -0.04, wc.y + parW.y * zL) : 1.0;      // the lower sash under the meeting rail
                vec3 fc = mix(mix(frc * 0.42, frc * 0.62 * ush, mL), mix(frc, casC * mix(1.12, 0.9, clamp(deF / 0.07, 0.0, 1.0)) * (0.9 + 0.2 * vnoise(wcl * vec2(3.0, 2.0) + id)), cas), mU) * (1.0 + 2.4 * hl) * (1.0 - 0.55 * hd) + vec3(0.035, 0.035, 0.037) * hl;
                fc *= 0.86 + 0.28 * vnoise(vec2(wcl.x * 3.0 + wcl.y * 55.0, wcl.y * 3.0 + wcl.x * 55.0) * 0.5 + id);      // brush marks and chalking: never one even tone
                if (false && ySp && fPx < 0.012) {      // glass53: off (a critic read them as identical repeated marks)
                     // hardware: the sash lock on the meeting rail, two lifts on the bottom rail
                  float xc = wk > 0.5 ? sign(pF.x) * half_.x * 0.5 : 0.0; float nearH = smoothstep(0.012, 0.006, fPx);
                  float lk = mU * AAL(abs(pF.x - xc), 0.034, ap) * AAL(abs(pF.y - 0.022), 0.013, ap);
                  vec2 pL = wc + parW * zL; float lf = mL * (1.0 - mU) * AAL(abs(abs(pL.x - xc) - half_.x * (wk > 0.5 ? 0.2 : 0.4)), 0.03, ap) * AAL(abs(pL.y + half_.y - fb - 0.01), 0.011, ap);
                  fc = mix(fc, vec3(0.30, 0.25, 0.15) * (0.7 + 0.6 * hsh), max(lk, lf) * nearH * 0.85); }      // returns in their own shade, the lower sash darker behind the upper
                if (fPx < 0.05) { float lw_; float gk = winFr(wc + vec2(sdx * 0.022, 0.032), half_, fb, wk, ap + 0.022, lw_); gk = smoothstep(0.0, 0.6, max(gk, (ySp && !upH) ? lw_ : 0.0)) * smoothstep(0.05, 0.02, fPx); alb *= 1.0 - 0.6 * gk; fPane *= 1.0 - 0.6 * gk; fRefl *= 1.0 - 0.5 * gk; }      // the members stand in front of the glass: their shade lies on it under the head and rails and on the side away from the sun
                if (fPx < 0.02) { float lq; float mq = winFr(wc, half_, fb, wk, 0.011, lq); float put = smoothstep(0.10, 0.45, max(mq, (ySp && !upH) ? lq : 0.0)) * (1.0 - fr) * smoothstep(0.02, 0.01, fPx) * 0.8;
                  vec3 ptc = vec3(0.27, 0.26, 0.235) * (0.75 + 0.5 * hsh) * (0.8 + 0.4 * vnoise(wc * 23.0 + id)); alb = mix(alb, ptc, put); fPane = mix(fPane, ptc, put); fGlass *= 1.0 - put; if (put > 0.3) rough = 0.7; }      // the putty line round every light, paler than the sash
                alb = mix(alb, fc, fr); rough = fr > 0.02 ? 0.7 : rough; fGlass *= 1.0 - fr; fFrm = fr * fFlat;
                if (fr > 0.5) fNrmT = normalize(mix(sideN, vec3(0.0, 0.0, 1.0), max(mU, mL)));      // never blended with the glass's own tilt: a half-covered pixel would mirror somewhere else entirely
                fShade *= mix(fsh, 1.0, mU);
                if (ribbon < 0.5) {      // the sill nose stands out in front of everything: its face from below, its top from above
                  float fNz = fFlat * (1.0 - fStn); float snz = 0.05 + 0.045 * fNz; vec2 pS = wcl + parW * 0.15; float sF = 1.0 - smoothstep(-ap, ap, pS.y + half_.y - snz), sT = 1.0 - smoothstep(-ap, ap, wcl.y + half_.y - snz); float sl = max(sF, sT);
                  alb = mix(alb, mix(frc * mix(1.45, 1.15, sF), vec3(0.27, 0.26, 0.24) * (0.85 + 0.3 * vnoise(wcl * vec2(9.0, 40.0) + id)), fNz), sl); fFrm *= 1.0 - sl; fGlass *= 1.0 - sl; if (sl > 0.5) fNrmT = normalize(sF > 0.5 ? vec3(0.0, 0.25, 1.0) : vec3(0.0, 1.0, 0.2)); fShade = mix(fShade, 1.0, sl * step(st3.z, 0.02)); if (sl > 0.02) rough = 0.7;
                  // and under the nose, and under the meeting rail and the head, what lies behind sits in their shade (sky light is cut off as well as sun)
                  float us = (1.0 - sl) * smoothstep(0.10, 0.0, pS.y + half_.y - snz) * 0.5; alb *= 1.0 - us; fPane *= 1.0 - us; }
              }
`;

export function makeFacadeMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.shadowSide = THREE.DoubleSide;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tWallA: { value: shared.tWallA.value }, tWallN: { value: shared.tWallN.value }, tSign: { value: shared.tSign.value } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 color; attribute vec2 uv1; attribute vec2 uv2; attribute vec2 uv3;
        varying vec2 vFuv; varying vec2 vFst; varying vec2 vLay; varying vec2 vLay2; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vBake;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFuv = vec2(uv.x, 1.0 - uv.y); vFst = vec2(uv1.x, 1.0 - uv1.y); vLay = vec2(uv2.x, 1.0 - uv2.y); vLay2 = vec2(uv3.x, 1.0 - uv3.y); vBake = color.rgb;
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        #define REALREFL ${REALREFL.toFixed(2)}
        varying vec2 vFuv; varying vec2 vFst; varying vec2 vLay; varying vec2 vLay2; varying vec3 vWPos; varying vec3 vWNrm; varying vec3 vBake;
        uniform sampler2DArray tWallA; uniform sampler2DArray tWallN; uniform sampler2D tSign; uniform samplerCube tStreet; uniform sampler2DArray tPanel; uniform sampler2DArray tPanelR; uniform sampler2DArray tPanelH; uniform float uPanelH[32]; uniform vec4 uPanel[32]; uniform vec2 uStyleP[5];
        uniform vec3 uSunColor; uniform vec3 uSunDir; uniform float uShadowFar; uniform vec3 uShadowCenter; uniform float uTime;
        ${NOISE_GLSL}
        #define AAL(d, w, a) (1.0 - smoothstep((w) - (a), (w) + (a), (d)))
        // glass52: the few panels seen close have a sharp copy (2048 px) in tPanelH; uPanelH gives its layer, -1 where there is none
        float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
        // glass61: a stone standing P metres in front of the wall over the rectangle rc (x0, y0, x1, y1; y down). p = the wall point the eye's ray ends on, d = how far the ray stands off that point per metre in front of the wall.
        // Returns x = 0 not met, 1 its face, 2 its underside or top, 3 an end; yz = the point of the rectangle that is seen.
        vec3 proudBox(vec2 p, vec2 d, vec4 rc, float P) {
          vec2 dd = vec2(abs(d.x) < 1e-4 ? 1e-4 : d.x, abs(d.y) < 1e-4 ? 1e-4 : d.y);
          vec2 ta = (rc.xy - p) / dd, tb = (rc.zw - p) / dd; vec2 tn = min(ta, tb), tf = max(ta, tb);
          float za = max(max(tn.x, tn.y), 0.0), zb = min(min(tf.x, tf.y), P);
          if (za >= zb) return vec3(0.0);
          vec2 h = p + dd * zb; if (zb >= P) return vec3(1.0, h);
          return vec3(tf.y < tf.x ? 2.0 : 3.0, h); }
        float sdStar5(vec2 p, float r, float rf) { const vec2 k1 = vec2(0.809016994375, -0.587785252292); const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
          p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x); p.y -= r;
          vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r); return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y); }
        vec4 panelTex(vec2 uvp, float plp, vec2 dxp, vec2 dyp) { float hl = uPanelH[int(plp)]; if (hl > -0.5) return textureGrad(tPanelH, vec3(uvp, hl), dxp, dyp); return textureGrad(tPanel, vec3(uvp, plp), dxp, dyp); }
        // the members of a window at p (metres from its centre): returns the outer layer (casing, upper sash, mullions, bars), low = the lower sash of a double-hung window.
        // wk: 0 one double-hung sash pair, 1 two side by side, 2 two casements, 3 loft (three lights and a transom), 4 ribbon
        float winFr(vec2 p, vec2 hf, float fb, float wk, float ap, out float low) {
          vec2 e = hf - abs(p); float de = min(e.x, e.y); low = 0.0;
          float ringS = 1.0 - smoothstep(fb - ap, fb + ap, de);
          if (wk < 1.5) {
            float ringC = 1.0 - smoothstep(0.07 - ap, 0.07 + ap, de); float upH = smoothstep(0.02 - ap, 0.02 + ap, p.y);
            float mull = wk > 0.5 ? AAL(abs(p.x), 0.065, ap) : 0.0;
            low = max((1.0 - upH) * max(ringS, max(AAL(p.y + hf.y - fb, 0.05, ap), wk > 0.5 ? AAL(abs(p.x), 0.09, ap) : 0.0)), AAL(abs(p.y + 0.015), 0.035, ap));
            return max(max(ringC, mull), max(ringS * upH, AAL(abs(p.y - 0.02), 0.045, ap)));
          }
          if (wk < 2.5) return max(ringS, AAL(abs(p.x), 0.025, ap));
          if (wk < 3.5) return max(ringS, max(AAL(abs(abs(p.x) - hf.x * 0.36), 0.042, ap), AAL(abs(p.y - hf.y * 0.42), 0.042, ap)));
          return ringS;
        }
        vec3 fAlb; float fRough; float fMetal; vec3 fNrmT; float fGlass; vec3 fEmis; vec3 bakeV; vec3 bakeN;
        vec3 fT; vec3 fB; vec3 fN; vec3 fAvg; float fVeil; float fRefl; vec3 fPane; vec3 fGT; float fF0; float fPx; float fDirt; float fFlat; float fFrm; float fStn;

        // a room seen through the glass: ray from p (metres in the window, origin at its centre) going inward along d (tangent space, z into the wall)
        vec3 roomColor(vec2 p, vec3 d, vec2 size, float depth, vec2 id, float lit) {
          vec3 inv = 1.0 / (abs(d) + 1e-4);
          vec3 lim = vec3(size * 0.5 * 1.6, depth);
          vec3 t3 = vec3((lim.x - p.x * sign(d.x)) * inv.x, (lim.y - p.y * sign(d.y)) * inv.y, depth * inv.z);
          float t = min(min(t3.x, t3.y), t3.z);
          vec3 h = vec3(p, 0.0) + d * t;
          vec3 hs = hash32(id + 3.7);
          vec3 wallc = mix(vec3(0.55, 0.52, 0.47), vec3(0.62, 0.6, 0.58), hs.x) * (0.5 + 0.5 * hs.y);
          vec3 col; vec3 glow = vec3(0.0);
          if (t == t3.z) { col = wallc * 0.8 * (0.45 + 0.8 * vnoise(h.xy * vec2(0.9, 1.4) + id * 7.0)); }   // back wall, things standing against it
          else if (t == t3.y) { if (d.y > 0.0) { float tube = step(0.94, fract(h.z * 0.55 + hs.x)) * step(fract(h.x * 0.42 + hs.y), 0.72); col = vec3(0.75) * (lit > 0.5 ? 1.6 : 1.0); glow = lit * tube * mix(vec3(1.0, 0.80, 0.55), vec3(0.92, 0.96, 1.0), hs.z) * 0.7; } else col = vec3(0.28, 0.22, 0.17); }   // ceiling (rows of tube lights where the room is lit) / floor
          else col = wallc * 0.65;
          float fall = exp(-t * 0.35);
          float day = 0.018 + 0.07 * fall;                         // daylight falling off into the room
          return col * (day + lit * 0.03) + glow;
        }

        // what hangs just behind the glass: p = metres in the light (origin its centre), hf = its half size, px = metres a pixel.
        // rgb = its colour, a = how much of the room it hides.
        vec4 blindColor(vec2 p, vec2 hf, vec2 id, float habit, float fav, vec3 bcol, float px) {
          vec3 r = hash32(id + 2.0); vec3 r2 = hash32(id + 41.0);
          vec4 o = vec4(0.0);
          if (r.x > habit) return o;
          if (r2.x < 0.82) {
            // a roller shade or venetian blind let down from the head: the building's usual height, or the tenant's own
            float s = r.y < 0.55 ? fav : fract(r.y * 7.3);
            float cov = r.z < 0.2 ? 1.0 : 0.18 + 0.62 * s;
            float ven = step(r2.x, 0.5);
            float yb = hf.y - 2.0 * hf.y * cov + p.x * (r2.y - 0.5) * 0.12 * step(0.6, r2.z) * ven;
            float m = smoothstep(yb - px, yb + px, p.y);
            vec3 c = bcol * (0.8 + 0.35 * r2.y);
            c *= 1.0 - ven * 0.25 * (0.5 + 0.5 * sin(p.y * 190.0)) * smoothstep(0.012, 0.004, px);     // 33 mm slats, near only
            c *= 0.88 + 0.24 * vnoise(vec2(p.x * 2.5 + id.x, p.y * 0.7 + id.y));                        // never quite even
            c *= 1.0 - 0.5 * smoothstep(0.04 + px, 0.0, p.y - yb);                                      // bottom rail and its shade
            c *= 1.0 - 0.3 * ven * step(abs(abs(p.x) - hf.x * 0.55), 0.006) * smoothstep(0.02, 0.006, px);   // cords
            o = vec4(c, m * (1.0 - 0.45 * ven * step(0.72, r2.z)));                                     // slats tilted open: half see-through
          } else {
            // curtains drawn to the sides, some with a sheer across
            float w = hf.x * (0.25 + 0.5 * r.y);
            float m = smoothstep(hf.x - w - px, hf.x - w + px, abs(p.x) + 0.03 * sin(p.y * 3.0 + r.z * 6.0));
            float fold = mix(0.85, 0.75 + 0.25 * sin(p.x * (34.0 + 40.0 * r.x / max(habit, 0.05)) + 2.0 * sin(p.y * 1.3 + r.z * 9.0)), smoothstep(0.03, 0.01, px)); fold = mix(0.86 + 0.1 * vnoise(p * vec2(6.0, 0.8) + id), fold, m);
            vec3 c = mix(bcol, hash32(id + 77.0) * 0.5 + 0.25, step(0.6, r2.y) * 0.7) * fold;
            o = vec4(c, max(m, step(0.8, r2.z) * 0.3));
          }
          return o;
        }

        float fShade;
        void facade() {
          float style = floor(vFst.x + 1e-3); float seed = (floor(fract(vFst.x) * 512.0) + 0.5) / 512.0; float H = vFst.y;
          float bw = max(vLay.x, 0.5), fh = max(vLay.y, 2.4); float kind = floor(vLay2.x / 64.0 + 0.01); float gh = vLay2.x - 64.0 * kind; float bigWin = floor(gh / 16.0 + 0.01); gh -= 16.0 * bigWin; float v0 = vLay2.y;
          vec3 N = normalize(vWNrm); if (!gl_FrontFacing) N = -N;
          vec3 V = normalize(cameraPosition - vWPos);
          fN = N; fNrmT = vec3(0.0, 0.0, 1.0); fGlass = 0.0; fEmis = vec3(0.0); fMetal = 0.0; fShade = 1.0; fAvg = vec3(-1.0); fRefl = 0.5; fPane = vec3(0.0); fGT = vec3(0.78, 0.82, 0.80); fF0 = 0.10; fDirt = 0.0; fVeil = 0.0; fFlat = 0.0; fFrm = 0.0; fStn = 0.0;
          vec2 uv = vFuv; fPx = max(fwidth(vFuv.x), fwidth(vFuv.y)); float u = uv.x, v = uv.y;
          vec3 h3 = hash32(vec2(seed * 913.0, seed * 37.0 + 1.0)); vec3 h4 = hash32(vec2(seed * 211.0 + 7.0, seed * 59.0));
          // ---------------- roofs
          if (style > 8.5) {
            vec2 w = vWPos.xz;
            float n = fbm(w * 0.35 + seed * 50.0), n2 = vnoise(w * 6.0);
            vec3 tar = mix(vec3(0.10, 0.10, 0.105), vec3(0.19, 0.18, 0.17), n) + (n2 - 0.5) * 0.03;
            vec3 pale = mix(vec3(0.42, 0.42, 0.40), vec3(0.50, 0.49, 0.46), n);      // silver / white roof coating
            vec3 c = h3.x < 0.28 ? pale : (h3.x < 0.36 ? vec3(0.30, 0.19, 0.15) * (0.7 + 0.5 * n) : tar);
            float seams = smoothstep(0.03, 0.0, abs(fract(dot(w, vec2(0.875, 0.484)) / 1.0 + seed) - 0.5) - 0.47);
            float pond = smoothstep(0.55, 0.75, fbm(w * 0.12 + seed * 9.0));                 // ponding stains and patches
            fAlb = c * (1.0 - 0.18 * seams) * (1.0 - 0.25 * pond); fRough = 0.92; fT = vec3(1, 0, 0); fB = vec3(0, 0, 1);
            return;
          }
          vec3 dp1 = dFdx(vWPos), dp2 = dFdy(vWPos); vec2 du1 = dFdx(uv), du2 = dFdy(uv);
          vec3 T = dp1 * du2.y - dp2 * du1.y, B = -dp1 * du2.x + dp2 * du1.x;
          float tl = length(T), bl = length(B);
          T = tl > 1e-9 ? T / tl : normalize(cross(vec3(0, 1, 0), N)); B = bl > 1e-9 ? B / bl : vec3(0, 1, 0);
          if (kind < 4.5) { T = normalize(cross(vec3(0.0, 1.0, 0.0), N)); B = vec3(0.0, 1.0, 0.0); if (dot(T, dp1 * du2.y - dp2 * du1.y) < 0.0) T = -T; }   // walls are upright: an exact frame
          fT = T; fB = B;
          vec3 vt = vec3(dot(V, T), dot(V, B), max(dot(V, N), 0.05));
          vec2 par = vt.xy / vt.z;                      // metres of sideways shift per metre of depth
          vec3 st3 = vec3(dot(uSunDir, T), dot(uSunDir, B), dot(uSunDir, N)); vec2 spar = st3.xy / max(st3.z, 0.03);   // the same for the sun's ray

          // ---------------- per-style layout (the bay width, storey height and ground storey come from the building)
          float ww, wh, sill; int layer; vec3 tint; float texScale = 1.25; float ribbon = 0.0; float pairW = 0.0; float depth = 0.2;
          int shaftLayer; vec3 shaftTint;
          if (style < 0.5)      { ww = min(bw - 0.95, 1.0 + h3.y * 0.2); wh = 1.75; sill = 0.8; layer = h3.z < 0.55 ? 0 : (h3.z < 0.75 ? 4 : 3); depth = 0.24;
                                  tint = mix(vec3(0.82, 0.74, 0.70), vec3(1.08, 0.98, 0.94), h3.x); if (h4.x < 0.16) { layer = 1; tint = mix(vec3(0.62, 0.50, 0.42), vec3(0.95, 0.92, 0.86), h4.y); } }
          else if (style < 1.5) { ww = 1.02 + h3.y * 0.12; wh = 2.0; sill = 0.85; layer = 1; depth = 0.42; pairW = bw > 2.65 ? 1.0 : 0.0; if (pairW < 0.5) ww = min(bw - 1.0, 1.35);
                                  if (bigWin > 0.5) { pairW = 0.0; ww = bw - 1.05; wh = fh - 1.3; sill = 0.78; }      // commercial blocks: one wide window a bay
                                  tint = mix(vec3(0.97, 0.90, 0.78), vec3(0.86, 0.82, 0.75), h3.x) * (1.0 + 0.2 * h3.z); texScale = 1.3; }
          else if (style < 2.5) { ww = bw; wh = fh; sill = 0.0; layer = 2; tint = vec3(1.0); }
          else if (style < 3.5) { ww = bw; wh = 1.55; sill = 0.92; layer = h3.z < 0.55 ? 4 : 2; ribbon = h3.y < 0.45 ? 1.0 : 0.0; if (ribbon < 0.5) { ww = bw - 0.5; wh = 1.6; } depth = 0.12;
                                  tint = h3.z < 0.55 ? mix(vec3(1.05, 1.0, 0.9), vec3(1.28, 1.25, 1.18), h3.y) : vec3(1.05, 1.03, 1.0);
                                  if (h4.y < 0.4) { layer = 3; tint = mix(vec3(0.62, 0.55, 0.50), vec3(0.85, 0.75, 0.68), h4.x); } else if (h4.y < 0.6) { layer = 0; tint = vec3(0.9, 0.82, 0.78); } }
          else                  { ww = bw - 1.05; wh = fh - 1.15; sill = 0.72; layer = h3.y < 0.42 ? 3 : (h3.y < 0.62 ? 0 : 1); depth = 0.36;
                                  tint = layer == 1 ? mix(vec3(0.97, 0.93, 0.85), vec3(0.74, 0.72, 0.70), h3.x) : mix(vec3(0.75, 0.7, 0.68), vec3(1.0, 0.95, 0.9), h3.x); if (layer == 1) texScale = 2.0; }
          if (style > 0.5 && style < 1.5) tint *= mix(vec3(1.0), vec3(0.80, 0.78, 0.74), smoothstep(90.0, 220.0, H));
          shaftLayer = layer; shaftTint = tint;
          if (style > 0.5 && style < 1.5 && h4.z < (H > 55.0 ? 0.08 : 0.5)) { shaftLayer = h4.x < 0.45 ? 4 : (h4.x < 0.8 ? 0 : 3); shaftTint = mix(vec3(0.85, 0.78, 0.72), vec3(1.08, 1.0, 0.93), h4.y); }   // a brick shaft between a stone base and cap
          bool glassTower = style > 1.5 && style < 2.5;
          bool masonry = !glassTower;
          bool secondary = kind > 1.5 && kind < 4.5 && masonry;       // court, party and bulkhead walls: common brick, not the front's stone
          if (secondary && style < 1.5 || secondary && style > 3.5) { layer = h4.y < 0.8 ? 0 : 3; tint = mix(vec3(0.72, 0.61, 0.56), vec3(0.93, 0.81, 0.75), h4.x); shaftLayer = layer; shaftTint = tint; texScale = 1.25; }

          // ---------------- storeys and bays
          float fl = (v - gh) / fh; float fi = floor(fl); float fv = fract(fl) * fh;
          float bayx = u / bw; float bi = floor(bayx); float fu = (fract(bayx) - 0.5) * bw;     // metres from bay centre
          float top = H - v;
          float capZone = masonry ? (style > 0.5 && style < 1.5 ? clamp(0.032 * H + 0.35, 0.75, 2.6) + 0.9 : clamp(0.02 * H + 0.6, 0.8, 1.6) + 0.5) : 0.6;
          if (kind > 1.5) capZone = 0.7;
          float nFloors = max(1.0, floor((H - capZone - gh) / fh));
          float baseF = H > 40.0 ? 2.0 : 1.0, capF = H > 40.0 ? 2.0 : 1.0;
          bool isStone = style > 0.5 && style < 1.5 && !secondary;
          bool isBase = isStone && fi < baseF && nFloors > 5.5, isCap = isStone && fi >= nFloors - capF && nFloors > 5.5;
          bool store = v < gh && kind < 0.5;
          bool shaft = isStone && !isBase && !isCap && fi >= 0.0;
          if (shaft) { layer = shaftLayer; tint = shaftTint; if (layer != 1) texScale = 1.25; }

          // ---------------- masonry
          float lsc = layer == 4 ? 0.36 : (layer == 3 ? 0.6 : (layer == 0 ? 0.8 : 1.0)); vec2 tuv = uv / (texScale * lsc) + seed * 7.0;
          vec3 alb = texture(tWallA, vec3(tuv, float(layer))).rgb * tint;
          vec3 nt = texture(tWallN, vec3(tuv, float(layer))).xyz * 2.0 - 1.0;
          if (layer == 1) { float m_ = dot(alb, vec3(0.333)); alb = mix(vec3(m_), alb, 0.45); alb = mix(vec3(dot(tint, vec3(0.333)) * 0.55), alb, 0.5); nt.xy *= 0.5; }      // ashlar: pale, even, fine-jointed
          float streak = fbm(vec2(u * 0.9 + seed * 20.0, v * 0.07)); float grime = fbm(uv * 0.11 + seed * 9.0);
          float big = fbm(uv * 0.035 + seed * 31.0), soot = fbm(vec2(u * 0.5 + seed * 3.0, v * 0.03 + 5.0));
          alb *= mix(vec3(1.0), vec3(1.1, 0.96, 0.9), fbm(uv * 0.05 + seed * 3.0)) ;
          alb *= 0.74 + 0.36 * grime; alb *= mix(1.0, kind > 2.5 ? 0.9 : 0.74, smoothstep(0.5, 0.9, streak));
          alb = mix(alb, alb * vec3(0.62, 0.60, 0.60), smoothstep(0.45, 0.8, soot) * 0.8);            // soot washes down the wall
          alb = mix(alb, vec3(dot(alb, vec3(0.34))) * 1.12, smoothstep(0.62, 0.8, big) * 0.14);       // paler, repointed or sun-bleached patches
          alb *= 0.9 + 0.2 * hash11(floor((v - gh) / fh) + seed * 91.0);                              // each storey a touch different
          alb *= mix(0.62, 1.0, smoothstep(0.0, 3.0, v));       // street grime near the pavement
          alb *= 1.0 - 0.35 * smoothstep(2.5, 0.0, top) * (0.4 + 0.6 * streak);                        // rain streaks under the roof line
          if (kind < 1.5) alb *= 1.0 - 0.38 * smoothstep(capZone + 1.6, capZone, top) * step(capZone, top);            // the cornice's shade on the wall below
          fAvg = alb * (glassTower ? 0.0 : 0.74) + (glassTower ? vec3(0.07, 0.09, 0.11) : vec3(0.0));
          float rough = 0.9;
          vec3 frameCol = h3.y < 0.45 ? vec3(0.066, 0.064, 0.062) : (h3.y < 0.7 ? vec3(0.105, 0.088, 0.07) : (h3.y < 0.85 ? vec3(0.125, 0.088, 0.064) : vec3(0.06, 0.105, 0.082)));
          if (style < 0.5 && h4.z < 0.3) frameCol = vec3(0.45, 0.45, 0.43);       // white replacement windows

          // ---------------- trim that is real geometry: cornices, belt courses, piers
          if (kind > 4.5) {
            vec3 c;
            if (kind < 5.5) { c = alb * 1.08; { vec2 spT = uStyleP[int(style)]; if (spT.y > 0.5 && (style < 1.5 || style > 3.5)) {      // glass53: a pier on a photo-panel front takes the photo's own brick colour (the panel's edge is mid-pier), with the tiling brick only as faint coursing
                float sqT = floor(seed * 512.0); float plT = spT.x + floor(hash21(vec2(sqT, 7.0)) * spT.y * 0.999); vec3 pmT = textureLod(tPanel, vec3(0.015, 0.62, plT), 5.0).rgb;
                vec3 t0T = mix(vec3(0.86), vec3(1.1), h3.x) * (1.0 + (h3.yzx - 0.5) * 0.07); vec3 rT = clamp(alb / max(textureLod(tWallA, vec3(0.5, 0.5, float(layer)), 10.0).rgb * tint, vec3(0.02)), 0.5, 1.6); rT = mix(vec3(1.0), vec3(dot(rT, vec3(0.3333))), 0.3);
                c = pmT * t0T * rT * (0.9 + 0.16 * grime); } } if (style < 0.5) c = mix(vec3(0.50, 0.38, 0.30), vec3(0.66, 0.63, 0.57), h4.y) * (0.75 + 0.35 * grime);  if (style > 2.5 && style < 3.5) c = vec3(0.17, 0.165, 0.155) * (0.7 + 0.45 * grime); }
            else { vec3 paint = h4.x < 0.3 ? vec3(0.07, 0.10, 0.08) : (h4.x < 0.55 ? vec3(0.16, 0.10, 0.07) : (h4.x < 0.8 ? vec3(0.50, 0.47, 0.40) : vec3(0.06, 0.06, 0.065)));
                   if (style > 1.5 && style < 3.5) paint = style > 2.5 ? vec3(0.07, 0.06, 0.055) : vec3(0.30, 0.31, 0.32);
                   c = paint * (0.7 + 0.5 * grime); rough = 0.6; float rust = smoothstep(0.62, 0.8, fbm(uv * 1.3 + seed * 5.0)); c = mix(c, vec3(0.22, 0.11, 0.06), rust * 0.5); }
            if (kind > 6.5 && kind < 7.5) {          // ironwork: fire escapes, tank stands. Black or dark paint, rust at the joints
              c = (h4.y < 0.6 ? vec3(0.035, 0.035, 0.038) : (h4.y < 0.8 ? vec3(0.10, 0.045, 0.03) : vec3(0.05, 0.07, 0.06))) * (0.8 + 0.5 * grime);
              c = mix(c, vec3(0.20, 0.10, 0.05), 0.45 * smoothstep(0.55, 0.8, fbm(vWPos.xy * 2.3 + vWPos.z)));
              if (abs(N.y) > 0.9) { float gx = (vWPos.x + vWPos.z) * 11.0; if (fwidth(gx) < 0.6 && fract(gx) > 0.42) discard; }
              fAlb = c; fRough = 0.65; fNrmT = vec3(0.0, 0.0, 1.0); return;
            }
            if (kind > 7.5 && kind < 8.5) {          // a window air conditioner: a beige or grey case, a louvred back, drip stains
              vec3 wp = vWPos; float louv = step(0.45, fract(wp.y * 28.0));
              c = mix(vec3(0.52, 0.50, 0.45), vec3(0.36, 0.36, 0.36), step(0.5, hash21(floor(wp.xz * 0.9)))) * (0.75 + 0.3 * grime);
              if (abs(N.y) < 0.5) c *= 0.6 + 0.4 * louv;
              c *= 1.0 - 0.3 * smoothstep(0.5, 0.8, fbm(wp.xy * 3.0 + wp.z));
              fAlb = c; fRough = 0.6; fNrmT = vec3(0.0, 0.0, 1.0); return;
            }
            if (kind > 8.5) {                        // a cedar water tank: grey-brown staves, iron hoops, damp at the foot
              float stave = 0.86 + 0.14 * hash11(floor(u / 0.14) + seed * 7.0); float hoop = smoothstep(0.035, 0.02, abs(fract(v / 0.42 + 0.3 * v * v * 0.02) - 0.5));
              c = mix(vec3(0.30, 0.22, 0.16), vec3(0.42, 0.37, 0.31), fbm(vec2(u * 0.6, v * 0.2) + seed * 3.0)) * stave;
              c *= 1.0 - 0.35 * smoothstep(1.2, 0.0, v) ; c = mix(c, vec3(0.05, 0.045, 0.04), hoop);
              fAlb = c; fRough = 0.85; fNrmT = vec3(0.0, 0.0, 1.0); return;
            }
            c *= 1.0 - 0.3 * smoothstep(0.5, 0.85, fbm(vec2(u * 2.0 + seed * 3.0, v * 0.25)));     // streaks
            fAlb = c; fRough = rough; fNrmT = normalize(vec3(nt.xy * 0.4, 1.0)); return;
          }

          // ---------------- fronts from photographs: one photographed bay of a real facade per window bay (panels.js)
          { vec2 sp = uStyleP[int(style)];
            if (sp.y > 0.5 && !store && kind < 1.5 && fi >= 0.0 && fi < nFloors) {
              float sq = floor(seed * 512.0);    // the seed as an exact integer: a hash of the raw varying flickers between panels on some GPUs
              float pl = sp.x + floor(hash21(vec2(sq, 7.0)) * sp.y * 0.999); vec4 pm = uPanel[int(pl)];
              float pr = bw / pm.z; float pk = pr >= 0.75 ? clamp(floor(pr + 0.5), 1.0, 3.0) : 1.0 / clamp(floor(pm.z / bw + 0.5), 1.0, 4.0); float cx = bayx * pk; float ci = floor(cx);   // a photo bay may be a group of windows: then it spans several layout bays
              vec3 ch = hash32(vec2(ci + sq * 3.0, fi + sq));
              float pcol = mod(ci + floor(hash21(vec2(sq, 11.0)) * pm.x * 0.999), pm.x), prow = mod(floor(hash21(vec2(sq, 13.0)) * pm.y * 0.999) - fi + 64.0 * pm.y, pm.y);      // glass47: bays and storeys in the photo's own order (a bay keeps its photographed neighbours: no seam, sills and courses run through)
              vec2 puv = vec2((pcol + fract(cx)) / pm.x, (prow + 1.0 - fract(fl)) / pm.y);
              vec2 pc0 = vec2(cx / pm.x, -fl / pm.y); vec2 pdx = dFdx(pc0), pdy = dFdy(pc0);
              vec4 pc = panelTex(puv, pl, pdx, pdy);
              vec3 t0 = mix(vec3(0.86), vec3(1.1), h3.x) * (1.0 + (h3.yzx - 0.5) * 0.07);
              float t1 = (0.9 + 0.16 * grime) * mix(1.0, 0.86, smoothstep(0.5, 0.9, streak)) * (1.0 - 0.3 * smoothstep(2.5, 0.0, top) * (0.4 + 0.6 * streak)) * (1.0 - 0.3 * smoothstep(capZone + 1.6, capZone, top) * step(capZone, top));
              float lodD = smoothstep(0.03, 0.10, fPx);      // glass56 (coordinator, wide spots): photographed masonry gets the soot washes, paler patches and storey-to-storey tone the drawn walls have, and at 150-300 m it greys and darkens (a clean red panel read as toy brick there)
              if (style < 1.5 || style > 2.5) t1 *= (1.0 - 0.34 * smoothstep(0.45, 0.8, soot) * (0.35 + 0.45 * lodD)) * (0.93 + 0.14 * hash11(fi + seed * 91.0)) * (1.0 - 0.14 * lodD) * (1.0 + 0.10 * (smoothstep(0.62, 0.8, big) - 0.3) * (0.4 + 0.6 * lodD));
              vec3 pa = pc.rgb * t0; pa = mix(vec3(dot(pa, vec3(0.333))), pa, (style < 1.5 || style > 2.5) ? 0.85 - 0.32 * lodD : 0.85) * t1;
              float pg = pc.a; vec3 pgs = pa; fAvg = vec3(-1.0); fNrmT = vec3(0.0, 0.0, 1.0);
              vec2 pnb = vec2(0.0); vec3 pbr = vec3(1.0); float pbk = 0.0; float trns = 0.0;
              // glass item: every photographed opening is rebuilt as a real window. tPanelR gives the opening's rectangle (the nearest one) in the panel; inside it the pane is set back
              // behind a reveal (jamb, head and sill each turned its own way to the sun), and the frame, sash, room, blinds and mirror are the drawn window's own (WIN_BODY).
              { vec4 R = texture(tPanelR, vec3(puv, pl)); vec2 cm = vec2(bw / pk, fh);
                vec2 pM = vec2(pcol + fract(cx), prow + 1.0 - fract(fl)) * cm; vec2 r0 = R.xy * pm.xy * cm - vec2(0.09, 0.06), r1 = R.zw * pm.xy * cm + vec2(0.09, 0.09);      // the opening takes in the photographed window's own frame (the panel's rectangle is its glass only): none of it may show beside the rebuilt window
                vec2 half_ = (r1 - r0) * 0.5; vec2 wp = vec2(pM.x - (r0.x + r1.x) * 0.5, (r0.y + r1.y) * 0.5 - pM.y);
                float lodP = smoothstep(0.10, 0.26, fPx); float st0 = style; if (st0 < 1.5) frameCol = h3.y < 0.5 ? vec3(0.032, 0.031, 0.030) : (h3.y < 0.8 ? vec3(0.06, 0.04, 0.03) : vec3(0.028, 0.045, 0.036));
                if ((st0 < 1.5 || st0 > 2.5) && half_.x > 0.17 && half_.y > 0.3 && lodP < 0.999) {
                  float pdep = st0 > 3.5 ? 0.26 : 0.22;      // glass56: 13 cm on brick flats (at 23 the jamb seen at a raking angle was a dark band 60 cm wide: critics read its edge as a seam down the wall)
                  float d2 = max(abs(wp.x) - half_.x, abs(wp.y) - half_.y);      // glass53: a brick flat's frame sits 16 cm back, a loft's 26 (30 everywhere drew a jamb a third of the window wide in raking views)
                  float nearS = 1.0 - lodP; float apS = fPx * 0.7; float tUp = clamp(-par.y, 0.0, 2.5); float nL3 = float(textureSize(tPanelR, 0).z / 3);
                  vec4 R2 = texture(tPanelR, vec3(puv, pl + nL3)); vec4 R3 = texture(tPanelR, vec3(puv, pl + 2.0 * nL3)); vec2 pmc = pm.xy * cm; bool crs = R2.y < -5.0;
                  float x0s = (R2.y + (crs ? 10.0 : 0.0)) * pmc.x, x1s = R2.z * pmc.x; float sdSt = 1e3; vec3 stC = vec3(0.0); fStn = R2.x > 0.0 ? 1.0 : 0.0;
                  // glass61: sills and lintels are stones standing in front of the wall (sill 7.5 cm, lintel 2.8 cm): the eye's ray is met by the stone's face, its underside or its end before it reaches the wall,
                  // so the stone hides the wall beyond it and the foot of the window, and shows its own underside from below. The face is the photographed stone (panels.json "sill" / "lintel").
                  if (lodP < 0.9) { vec2 dV = vec2(clamp(par.x, -2.5, 2.5), clamp(-par.y, -2.5, 2.5));
                    for (int k = 0; k < 2; k++) { vec4 bx; float P;
                      if (k == 0) { if (R2.x <= 0.0) continue; bx = vec4(crs ? -1e3 : x0s, r1.y, crs ? 1e3 : x1s, R2.x * pmc.y); P = 0.075; }
                      else { if (R3.w <= 0.0) continue; bx = vec4(R3.y * pmc.x, R3.x * pmc.y, R3.z * pmc.x, R3.w * pmc.y); P = 0.028; }
                      if (bx.w - bx.y < 0.02) continue;
                      vec3 hb = proudBox(pM, dV, bx, P); vec2 F = pM + dV * P; vec2 bc2 = (bx.xy + bx.zw) * 0.5, bh = (bx.zw - bx.xy) * 0.5;
                      float sdb = min(sdBox2(pM - bc2, bh), sdBox2(F - bc2, bh));
                      if (hb.x > 0.5 || sdb < apS) {
                        vec2 sp2 = clamp(hb.x > 0.5 ? hb.yz : F, bx.xy + 0.012, bx.zw - 0.012);
                        if (k == 0 && crs) { float wS = x1s - x0s; sp2.x = clamp(x0s + abs(mod(sp2.x - x0s, 2.0 * wS) - wS), x0s + 0.03, x1s - 0.03); }
                        vec3 sc = panelTex(sp2 / pmc, pl, pdx, pdy).rgb * t0; sc = mix(vec3(dot(sc, vec3(0.333))), sc, 0.85) * t1;
                        sc *= (0.88 + 0.2 * vnoise(vec2(sp2.x * 14.0 + sq, sp2.y * 1.5))) * (0.92 + 0.14 * vnoise(vec2(sp2.x * 3.1 + sq * 1.7, sp2.y * 9.0)));
                        sc *= hb.x > 2.5 ? 0.6 * (1.0 + 0.3 * sign(dV.x) * sign(st3.x)) : (hb.x > 1.5 ? (dV.y > 0.0 ? 0.26 + 0.1 * smoothstep(0.0, P, length(hb.yz - F)) : 1.15) : 1.0);
                        if (k == 0 && hb.x > 0.5 && hb.x < 1.5) sc *= 1.0 - 0.18 * smoothstep(0.03, 0.0, hb.z - bx.y) * step(0.0, dV.y);      // the top arris of the sill under the window's own wooden sill: a shade line
                        if (hb.x > 0.5) { fAlb = mix(pa, sc, nearS > 0.5 ? 1.0 : nearS * 2.0); fRough = 0.88; fNrmT = vec3(0.0, 0.0, 1.0); return; }
                        if (sdb < sdSt) { sdSt = sdb; stC = sc; } } } }
                  if (d2 > 0.0) {
                    // the sill's shadow on the wall under it
                    float yb = -half_.y - wp.y; float sl = clamp(0.07 * spar.y, 0.0, 0.3); float sxo = 0.0; float sof = 0.0;
                    // glass52: sills and lintels stand proud of the wall (sill 9 cm, lintel 5 cm; panels.json "sill" and "lintel" per opening, tPanelR's second and third sets).
                    // Seen from below, the foot of the photographed band is the stone's soffit (dark), the wall under it is in its contact shade, and in sun it throws a shadow as long as the sun is high.
                    { float eT = pM.y - R2.w * pmc.y; bool sTop = R2.w > 0.0 && eT > -0.3 && eT < 0.7;      // R2.w: the foot of a sill course that hangs into this panel from the storey above its top edge
                      if (R2.x > 0.0 || sTop) { float e = sTop ? eT : pM.y - R2.x * pmc.y; float xa = (sTop || crs) ? -1e3 : x0s, xb = (sTop || crs) ? 1e3 : x1s;
                        float inx = smoothstep(xa - 0.05, xa + 0.02, pM.x) * (1.0 - smoothstep(xb - 0.02, xb + 0.05, pM.x));
                        float con = inx * smoothstep(-apS, apS, e) * (0.62 * (1.0 - smoothstep(0.0, 0.17, e)) + 0.3 * (1.0 - smoothstep(0.0, 0.035, e)));      // the wall under the stone sees less sky: darkest in the corner
                        float drp = inx * smoothstep(0.0, 0.05, e) * (1.0 - smoothstep(0.1, st0 < 1.5 ? 1.1 : 0.7, e)) * smoothstep(0.45, 0.8, vnoise(vec2(pM.x * 9.0 + sq, e * 0.6)));      // dirt washed off the sill runs down the wall under it
                        pa *= (1.0 - con * nearS) * (1.0 - (st0 < 1.5 ? 0.42 : 0.3) * drp);
                        yb = e; sxo = 1.0; float Ls = 0.075 * clamp(spar.y, 0.0, 4.0); float xs = pM.x + 0.075 * clamp(spar.x, -3.0, 3.0); float inxs = step(xa, xs) * step(xs, xb);
                        float ss2 = step(0.02, st3.z) * inxs * smoothstep(-0.01, 0.01, e) * (1.0 - smoothstep(Ls - 0.012, Ls + 0.012, e));
                        fShade = 1.0 - 0.8 * ss2 * nearS; } }
                    if (sxo < 0.5) { float ss = step(0.02, st3.z) * step(abs(wp.x + 0.07 * clamp(spar.x, -3.0, 3.0)), half_.x + 0.06) * smoothstep(-0.01, 0.01, yb) * (1.0 - smoothstep(0.02 + sl, 0.05 + sl, yb));
                      fShade = 1.0 - 0.6 * ss * (1.0 - lodP); }
                    if (R3.w > 0.0) { float e2 = pM.y - R3.w * pmc.y; float x0l = R3.y * pmc.x, x1l = R3.z * pmc.x;      // the lintel over this opening: [top, x0, x1, underside]
                        float inl = smoothstep(x0l - apS, x0l + apS, pM.x) * (1.0 - smoothstep(x1l - apS, x1l + apS, pM.x)) * step(half_.x, abs(wp.x));      // its ends beside the opening (over the opening its underside is the head of the reveal)
                        float conl = inl * smoothstep(-apS, apS, e2) * (1.0 - smoothstep(0.0, 0.07, e2));
                        float eTop = pM.y - R3.x * pmc.y; float ledge = step(x0l, pM.x) * step(pM.x, x1l) * smoothstep(-0.05, 0.0, eTop) * (1.0 - smoothstep(0.0, apS + 0.004, eTop));      // dirt lying on the top of the stone
                        pa *= (1.0 - 0.4 * conl * nearS) * (1.0 - 0.2 * ledge * nearS);
                        float Ll = 0.028 * clamp(spar.y, 0.0, 4.0); float xl = pM.x + 0.028 * clamp(spar.x, -3.0, 3.0);
                        float ssl = step(0.02, st3.z) * step(x0l, xl) * step(xl, x1l) * step(half_.x, abs(wp.x)) * smoothstep(-0.01, 0.01, e2) * (1.0 - smoothstep(Ll - 0.012, Ll + 0.012, e2));
                        fShade = min(fShade, 1.0 - 0.7 * ssl * nearS); }
                    if (st0 < 1.5 && nearS > 0.01) {      // glass61: iron anchor plates of the floor ties, between the window heads: a five-pointed cast star 3 cm proud of the brick with a hard shadow, rust washed down under it
                      vec2 dA2 = vec2(clamp(par.x, -2.5, 2.5), clamp(-par.y, -2.5, 2.5)) * 0.03; float bxA = (fract(cx + 0.5) - 0.5) * cm.x + dA2.x, yyA = pM.y - (r0.y - 0.5) + dA2.y; vec3 hA = hash32(vec2(floor(cx + 0.5) + sq * 5.0, fi * 3.0 + 1.0));
                      if (hA.x < 0.85 && abs(bxA) < 0.5 && abs(yyA) < 1.1) { float sdA = sdStar5(vec2(bxA, -yyA), 0.165, 0.46); float plA = 1.0 - smoothstep(-apS, apS, sdA);
                        vec2 soA = st3.z > 0.02 ? vec2(0.03 * clamp(spar.x, -3.0, 3.0), -0.03 * clamp(spar.y, 0.0, 4.0)) : vec2(0.0, -0.022); vec2 pSh = vec2(bxA, yyA) - dA2 + vec2(soA.x, soA.y);
                        float shA = (1.0 - smoothstep(-apS, apS + (st3.z > 0.02 ? 0.0 : 0.02), sdStar5(vec2(pSh.x, -pSh.y), 0.165, 0.46))) * (1.0 - plA);
                        float rnA = smoothstep(0.06, 0.0, abs(bxA + 0.03 * (hA.y - 0.5))) * smoothstep(0.05, 0.2, yyA) * (1.0 - smoothstep(0.3, 0.95, yyA)) * 0.3 * hA.z;
                        vec3 irA = vec3(0.020, 0.018, 0.017) * (0.8 + 0.5 * vnoise(vec2(bxA, yyA) * 40.0 + sq)) + vec3(0.022, 0.009, 0.004) * smoothstep(0.4, 0.8, vnoise(vec2(bxA, yyA) * 17.0 + sq));
                        float rA = length(vec2(bxA, yyA)); irA *= 1.0 + 1.2 * smoothstep(0.03, 0.0, abs(sdA + 0.012)) * step(yyA, 0.02) + 0.9 * smoothstep(0.035 + apS, 0.035 - apS, rA) - 0.5 * smoothstep(0.012, 0.0, abs(rA - 0.05));      // lit upper arrises, the nut, the ring round it
                        if (st3.z > 0.02) fShade = min(fShade, 1.0 - 0.8 * shA * nearS); else pa *= 1.0 - 0.6 * shA * nearS;
                        pa = mix(pa * (1.0 - rnA * nearS), irA, plA * nearS); } }
                    if (sdSt < apS) pa = mix(pa, stC, 0.5 * (1.0 - clamp(sdSt / apS, 0.0, 1.0)) * nearS);
                    fNrmT = normalize(vec3(pnb * 0.9 * (1.0 - sof), 1.0));
                    if (!(pg > 0.02 && d2 > 0.1)) { fAlb = mix(pa, mix(vec3(0.04), pa, lodP), smoothstep(0.35, 0.65, pg) * step(d2, 0.45)); fRough = 0.9; return; } trns = 1.0; pa *= 1.0 - 0.85 * smoothstep(0.0, 0.6, pg);      // (its soft edge is the frame's shadow line, not a rim of the photo's sky)      // glass57: a transom light (panels.json glass_transoms) falls through to the photographed-pane code below
                  }
                  if (d2 <= 0.0) {
                  vec2 q = wp - clamp(par, -2.5, 2.5) * pdep;
                  if (abs(q.x) > half_.x || abs(q.y) > half_.y) {
                    bool hv = abs(q.y) > half_.y;
                    float din = hv ? (abs(q.y) - half_.y) / max(abs(par.y), 0.05) : (abs(q.x) - half_.x) / max(abs(par.x), 0.05); float dr = clamp(din, 0.0, pdep);
                    vec2 eo = hv ? vec2(wp.x, sign(q.y) * (half_.y + 0.12 + pdep - dr)) : vec2(sign(q.x) * (half_.x + 0.16 + pdep - dr), wp.y);
                    vec2 euv = vec2((r0.x + r1.x) * 0.5 + eo.x, (r0.y + r1.y) * 0.5 - eo.y) / cm / pm.xy;
                    vec4 er4 = panelTex(clamp(euv, 0.002, 0.998), pl, pdx, pdy); vec3 er = er4.rgb * t0; er = mix(vec3(dot(er, vec3(0.333))), er, 0.85) * t1; er = mix(er, frameCol * 1.1 + 0.015, smoothstep(0.25, 0.6, er4.a)); if (st0 < 1.5) er = mix(er, mix(er * 0.7, frameCol * 2.4 + 0.008, 0.8), smoothstep(0.58, 0.46, clamp(din / pdep, 0.0, 1.0)));      // glass59: the outer half of the return is the brick itself (a half-brick), the inner half the dark brick-mould      // glass57: on brick flats the return is the window's own dark brick-mould: a recess with a hard edge, not a band of more brick      // where the photo beside the opening is more glass, the reveal is lined in the frame's colour
                    { float dn = clamp(din / pdep, 0.0, 1.0); float hwv = hash21(vec2(ci * 3.0 + floor(R.x * 29.0), fi) + sq);
                      er *= (hv ? (q.y > 0.0 ? mix(st0 < 1.5 ? 0.36 : 0.26, st0 < 1.5 ? 0.70 : 0.5, dn) * (0.9 + 0.2 * hwv) : mix(0.85, 1.06, dn)) : mix(0.36, 0.66, dn) * (0.9 + 0.2 * hwv) * (1.0 + 0.1 * sign(q.x) * sign(st3.x))) * (1.0 - 0.5 * smoothstep(0.035, 0.0, din))
                        * (0.9 + 0.2 * vnoise(vec2(wp.x + wp.y, din * 9.0) * 3.0 + sq)); }
                    vec3 rn = hv ? (q.y > 0.0 ? vec3(0.0, -0.5, 0.85) : vec3(0.0, 1.0, 0.15)) : vec3(-sign(q.x) * 0.6, 0.0, 0.8);      // head and jambs take most of their light as the wall does (a soffit normal goes black under the sky probe); their shade is in the colour
                    float cwr = clamp(0.5 + d2 / fPx, 0.0, 0.5);
                    fAlb = mix(mix(er, pa * 0.6, lodP), pa, cwr); fRough = 0.9; fFrm = st0 < 1.5 ? (1.0 - cwr * 2.0) * (1.0 - lodP) * smoothstep(0.58, 0.46, clamp(din / pdep, 0.0, 1.0)) : 0.0; fNrmT = normalize(mix(rn, vec3(0.0, 0.0, 1.0), max(lodP, cwr * 2.0) * 0.999)); return;
                  }
                  { vec2 wc = q; float half_id = 0.0; float ribbon = 0.0; float bi = ci * 3.0 + floor(R.x * 29.0); float pairS = (half_.x > (st0 < 1.5 ? 0.78 : 0.6) && half_.x <= 1.05) ? 1.0 : 0.0; fFlat = st0 < 1.5 ? 1.0 : 0.0;
                    if (st0 < 1.5) frameCol = h3.y < 0.5 ? vec3(0.032, 0.031, 0.030) : (h3.y < 0.8 ? vec3(0.06, 0.04, 0.03) : vec3(0.028, 0.045, 0.036));      // glass56: brick flats: one double-hung sash (pairs only over 1.55 m), sashes dark (the pale grey ones read as the sill course's own strip)
                    float style = half_.x > 1.05 ? 4.0 : (pairS > 0.5 ? 3.0 : min(st0, 1.0));
                    vec2 sq2 = q + clamp(spar, -3.0, 3.0) * pdep; float inSun = smoothstep(0.07, -0.07, abs(sq2.x) - half_.x) * smoothstep(0.07, -0.07, abs(sq2.y) - half_.y);
                    fShade = st3.z > 0.02 ? mix(0.12, 1.0, inSun) : 1.0;
                    if (style < 2.5 && wc.y < 0.02) fShade *= mix(1.0, 0.25, step(0.02 - 0.05 * max(spar.y, 0.0), wc.y) * step(0.02, st3.z));
${WIN_BODY}
                    { float hwv = hash21(vec2(bi, fi) + sq); float aoF = st0 > 3.5 ? 0.0 : 1.0; float ao = mix(0.55 + 0.12 * hwv - 0.22 * aoF, 1.0, smoothstep(0.0, pdep * (1.0 + 0.8 * aoF), half_.y - wc.y)) * mix(0.7 - 0.2 * aoF, 1.0, smoothstep(0.0, pdep * (0.6 + 0.6 * aoF), half_.x - abs(wc.x))) * mix(0.8, 1.0, smoothstep(0.0, 0.12, wc.y + half_.y)); alb *= ao; fPane *= ao; fRefl *= 0.6 + 0.4 * ao; }
                    vec3 pfar = min(vec3(dot(pa, vec3(0.333))) * 0.5, vec3(0.25));
                    alb = mix(alb, pfar, lodP); fPane = mix(fPane, pfar * 0.45, lodP); fGlass = mix(fGlass, 0.8, lodP); fNrmT = normalize(mix(fNrmT, vec3(0.0, 0.0, 1.0), lodP)); fShade = mix(fShade, 1.0, lodP);
                    float cw = clamp(0.5 + d2 / fPx, 0.0, 0.5); alb = mix(alb, pa, cw); fPane = mix(fPane, pa, cw); fGlass *= 1.0 - cw;
                    fAlb = alb; fRough = cw > 0.02 ? 0.9 : rough; return; }
                  }
                } }
              if (pg > 0.02) {
                // glass item: the photographed pane is set BACK in its opening. Look the photo up where the ray meets the glass plane: where that is masonry we see the reveal,
                // and the sun's ray from the glass must leave through the opening or the pane is in the opening's shadow.
                float pdep = 0.14; vec2 mc = vec2(pk / bw, -1.0 / fh); vec2 cc = vec2(fract(cx), 1.0 - fract(fl));
                vec2 qc = clamp(cc - clamp(par, -2.0, 2.0) * pdep * mc, 0.003, 0.997);
                vec4 pq = textureGrad(tPanel, vec3((vec2(pcol, prow) + qc) / pm.xy, pl), pdx, pdy);
                vec3 pqa = pq.rgb * t0; pqa = mix(vec3(dot(pqa, vec3(0.333))), pqa, 0.85) * t1;
                float rev = pg * (1.0 - pq.a); pgs = pqa;
                if (st3.z > 0.02) { vec2 sc = clamp(qc + clamp(spar, -3.0, 3.0) * 0.22 * mc, 0.003, 0.997);      // the photographed opening is deeper than the little extra set-back: its head and jamb throw a real shadow
                  float sa = textureGrad(tPanel, vec3((vec2(pcol, prow) + sc) / pm.xy, pl), pdx, pdy).a;
                  fShade = mix(1.0, mix(mix(0.10, 1.0, smoothstep(0.3, 0.7, sa)), 0.5, rev), pg); }
                pa = mix(pa, pqa * 0.8, rev); pg *= pq.a;
              }
              fGlass = pg * 0.8; fRefl = ch.z;
              vec3 pgl = mix(pgs, vec3(dot(pgs, vec3(0.333))), 0.75) * (0.55 + 0.7 * ch.z); pgl = min(pgl * (0.45 + 1.2 * dot(pgl, vec3(0.333))), vec3(0.45)); if (trns > 0.5) pgl *= 0.35;    // darks go to glass-dark, blinds stay light. Photographed glass keeps its blinds and frames but not one photo's blue sky: the live mirror supplies the reflection
              // each photo cell is one sheet set a little off true and bowed; what the photo shows behind the glass (blinds) is lit by the sun, under a thin dust film
              { vec2 cs = (vec2(fract(cx), fract(fl)) - 0.5) * 2.4 + (ch.xy - 0.5) * 0.8;
                vec2 bowp = vec2(sin(cs.x) * cos(cs.y), cos(cs.x) * sin(cs.y)) * (ch.z - 0.4) * 0.045;
                fNrmT = normalize(vec3(((ch.yx - 0.5) * vec2(0.06, 0.08) + bowp) * pg, 1.0));
                fF0 = 0.18 + 0.12 * hash21(vec2(sq, 3.0)); fGT = hash21(vec2(sq, 5.0)) < 0.5 ? vec3(0.78, 0.82, 0.80) : vec3(0.52, 0.66, 0.63);
                fDirt = 0.02 + 0.04 * vnoise(vec2(cx, fl) * vec2(3.1, 2.3) + sq); fPane = pgl * 0.45 + vec3(0.40, 0.38, 0.34) * fDirt * 0.35; }
              fNrmT = normalize(vec3(fNrmT.xy + pnb * 0.9 * (1.0 - pg), 1.0)); fAlb = mix(pa, pgl, pg); fRough = mix(0.9, 0.08, pg); return;
            } }

          if (glassTower && !store) {
            // curtain wall: mullion grid, spandrel band, tinted reflective glass
            vec3 gt = h3.x < 0.35 ? vec3(0.10, 0.16, 0.20) : (h3.x < 0.7 ? vec3(0.07, 0.09, 0.11) : vec3(0.16, 0.13, 0.09));
            float mx = abs(fu) - (bw * 0.5 - 0.04), my = min(fv, fh - fv) - 0.05;
            float mull = max(step(0.0, mx), step(my, 0.0));
            float span = step(fv, 0.95);
            vec2 id = vec2(bi, fi) + floor(seed * 512.0) * vec2(3.0, 1.0); float lit = step(0.90, hash21(id));
            vec3 room = roomColor(vec2(fu, fv - fh * 0.5), normalize(vec3(-par, 1.0)), vec2(bw, fh), 6.0, vec2(floor(bi / 3.0), fi) + floor(seed * 512.0) * vec2(1.0, 5.0), lit);
            float blind = step(0.7, hash21(id + 9.0)) * step(fh * (0.35 + 0.6 * hash21(id + 2.0)), fv);
            vec3 inside = mix(room * gt * 5.0, vec3(0.55, 0.54, 0.50) * gt * 2.2, blind) * (0.85 + 0.3 * hash21(id + 11.0));
            { vec3 pj = hash32(id * 1.7 + 3.0); fNrmT = normalize(vec3((pj.xy - 0.5) * 0.05 + (vec2(vnoise(vec2(fu, fv) * 1.1 + id), vnoise(vec2(fu, fv) * 1.1 + id + 9.0)) - 0.5) * 0.035, 1.0)); }
            alb = mix(inside, gt * 0.55, span);
            fGlass = 1.0; rough = 0.06; fMetal = 0.0; fF0 = 0.20 + 0.2 * h3.y; fGT = mix(vec3(1.0), gt * 6.0, 0.5); fRefl = hash21(id + 13.0);
            if (mull > 0.5) { alb = mix(vec3(0.07), vec3(0.42, 0.43, 0.44), step(0.5, h3.z)); rough = 0.35; fMetal = 0.9; fGlass = 0.0; }
            if (top < 1.6 || v < 0.5 || fi < 0.0) { alb = vec3(0.09); rough = 0.4; fMetal = 0.6; fGlass = 0.0; }
            fAlb = alb; fRough = rough; return;
          }

          if (!store) {
            fNrmT = normalize(vec3(nt.xy, 1.0));
            // ---- walls without a front: lot-line walls and bulkheads
            if (kind > 2.5) {
              float parge = step(0.72, hash21(floor(uv / vec2(7.0, 4.5) + seed * 17.0))) * smoothstep(0.3, 0.5, fbm(uv * 0.4 + seed * 5.0));                 // cement parging in patches
              alb = mix(alb, vec3(dot(alb, vec3(0.333))) * vec3(0.92, 0.9, 0.86), parge * step(0.5, h4.z) * 0.8);
              if (kind < 3.5) {
                alb *= mix(0.72, 1.0, smoothstep(v0 - 0.3, v0 + 2.5, v));                        // the dirt line of the neighbour's roof
                // a few small lot-line windows high above the neighbour, in some buildings
                float f0 = floor((v0 + 1.0 - gh) / fh) + 1.0;
                if (h4.x < 0.85 && fi >= f0 && fi < nFloors && (mod(bi + floor(seed * 7.0), 2.0) < 0.5 || h4.y > 0.5) && bw > 1.2) {
                  vec2 wq = vec2(fu, fv - (0.95 + 0.7));
                  if (abs(wq.x) < 0.5 && abs(wq.y) < 0.7) {
                    vec2 q = wq - par * 0.14;
                    if (abs(q.x) > 0.5 || abs(q.y) > 0.7) { fAlb = alb * 0.6; fRough = 0.9; return; }
                    float fr = max(step(0.45, abs(q.x)), max(step(0.65, abs(q.y)), step(abs(q.y), 0.03)));
                    fAlb = fr > 0.5 ? vec3(0.05) : vec3(0.05, 0.055, 0.06) * (0.5 + hash21(vec2(bi, fi) + 3.0)); fGlass = fr > 0.5 ? 0.0 : 1.0; fRough = fr > 0.5 ? 0.6 : 0.08; fNrmT = vec3(0.0, 0.0, 1.0); return;
                  }
                }
              }
              fAlb = alb; fRough = rough; return;
            }
            // ---- band courses and the painted cornice (the far city has no trim geometry; near, the real cornice stands in front of this)
            float cornH = capZone - (isStone ? 0.9 : 0.5);
            if (kind < 1.5 && top < cornH && H - v0 > 5.5) {
              float t = top / cornH; float dent = step(0.5, fract(u / 0.42)) * step(0.55, t) * step(t, 0.72); float brk = step(0.62, fract(u / 1.45)) * step(0.72, t);
              vec3 c = isStone ? alb * 1.15 : (style < 0.5 || style > 3.5 ? frameCol * 1.2 + 0.05 : alb * 1.1); c *= t < 0.18 ? 1.25 : (t < 0.5 ? 0.92 : 0.62); c *= 1.0 - 0.45 * dent; c *= 1.0 + 0.5 * brk;
              fAlb = c; fRough = 0.85; fNrmT = normalize(vec3(nt.xy * 0.5, 1.0) + vec3(0.0, t < 0.5 ? 0.5 : -0.9, 0.0)); return;
            }
            bool hasWin = fi >= 0.0 && fi < nFloors && gh + fi * fh > v0 - 0.3 && bw > 1.25;
            // window opening
            float y0 = sill, y1 = min(sill + wh, fh - 0.3);
            float hw = ww * 0.5;
            float fuw = fu; float half_id = 0.0;
            if (pairW > 0.5) { hw = min(hw, (bw - 1.18) * 0.25); half_id = step(0.0, fu); fuw = fu - sign(fu) * (hw + 0.14); }
            if (bigWin > 0.5) fuw = fu + (mod(bi, 2.0) < 0.5 ? 0.24 : -0.24);        // wide windows in twos, the broader pier between the pairs
            if (ribbon > 0.5) hw = bw;      // continuous band
            if (isStone) {
              // bay rhythm: stone piers read between the pairs; the base is rusticated, the cap has round heads
              if (isCap) y1 = min(y1 + 0.2, fh - 0.25);
              if (isBase) { y1 = min(y0 + wh + 0.35, fh - 0.3); if (bigWin > 0.5) { y0 = 0.3; y1 = fh - 0.22; } }      // a glazed base between the pilasters
            }
            bool inWin = hasWin && abs(fuw) < hw && fv > y0 && fv < y1;
            bool archTop = (isCap && fi > nFloors - 1.5) || (style > 3.5 && !secondary && h4.x < 0.5 && fi > nFloors - 1.5 && nFloors > 2.5);
            if (archTop && inWin && fv > y1 - hw && length(vec2(fuw, fv - (y1 - hw))) > hw) inWin = false;       // round-headed windows in the top storey
            if (!inWin) {
              if (hasWin && ribbon < 0.5 && !archTop) {
                float dx = abs(fuw) - hw, dy = max(y0 - fv, fv - y1); float de = max(dx, dy);
                if (de < fPx) { bool rev = dx > dy ? (sign(fuw) * par.x < 0.0) : ((fv < y0 ? par.y : -par.y) > 0.0);
                  if (!rev) alb = mix(alb, frameCol, clamp(0.5 - de / fPx, 0.0, 0.5)); }
              }
              if (hasWin && ribbon < 0.5) {
                // lintel + sill stones, with the shadow the sill throws and the stain that runs from it
                float lint = step(abs(fuw), hw + 0.12) * (step(y1, fv) * step(fv, y1 + 0.26) + step(y0 - 0.15, fv) * step(fv, y0));
                vec3 stone = layer != 1 ? mix(vec3(0.50, 0.40, 0.33), vec3(0.66, 0.63, 0.57), h4.y) * (0.75 + 0.35 * grime) : alb * 1.12;
                if (style > 3.5 && layer != 1) stone = alb * 0.8;
                if (style > 2.5 && style < 3.5) { lint *= step(fv, y0); stone = alb * 1.15; } alb = mix(alb, (layer == 1 ? alb * 1.3 : stone), lint);
                if (isStone && !isBase && H <= 55.0) { float arch_ = step(abs(fuw), hw + 0.2) * step(y0, fv) * step(fv, y1 + 0.26) * (1.0 - step(abs(fuw), hw)); alb *= 1.0 + 0.12 * arch_; alb *= 1.0 - 0.3 * smoothstep(0.03, 0.0, abs(abs(fuw) - hw - 0.2)) * step(y0, fv) * step(fv, y1 + 0.26); }
                float sillSh = step(abs(fuw - 0.03 * spar.x), hw + 0.14) * step(y0 - 0.15 - 0.14 * max(spar.y, 0.0) - 0.05, fv) * step(fv, y0 - 0.15);
                fShade = 1.0 - 0.75 * sillSh * step(0.03, st3.z);
                float drip = smoothstep(hw + 0.12, hw - 0.1, abs(fuw)) * pow(smoothstep(1.3, 0.0, y0 - fv), 1.6) * step(fv, y0 - 0.15) * smoothstep(0.35, 0.8, vnoise(vec2(u * 11.0 + seed * 9.0, v * 0.35)));
                alb *= 1.0 - 0.22 * drip;
                if (kind < 1.5 && !secondary) {
                  if (isBase) {   // rusticated base: deep channelled courses, light catching the upper edge of each block
                    float c = fract(fv / 0.62), j = smoothstep(0.06, 0.0, c) + smoothstep(0.94, 1.0, c); alb *= 1.0 - 0.6 * j; alb *= 1.0 + 0.10 * smoothstep(0.75, 0.9, c) * (1.0 - j);
                    float vj = smoothstep(0.03, 0.0, abs(fract(u / 1.3 + 0.5 * floor(fv / 0.62)) - 0.5) - 0.47); alb *= 1.0 - 0.35 * vj; fNrmT.y += (c < 0.08 ? 0.8 : (c > 0.92 ? -0.8 : 0.0));
                  } else if (isStone || style > 3.5) {
                    float keyst = step(abs(fuw), 0.16) * step(y1 + 0.02, fv) * step(fv, y1 + 0.42) * (isStone ? 1.0 : 0.0); alb = mix(alb, alb * 1.22, keyst);       // keystone over each window
                    float span = step(abs(fuw), hw + 0.06) * step(fv, y0 - 0.17) * step(0.12, fv);                 // recessed spandrel panel under the window
                    alb *= 1.0 - 0.14 * span; float se = span * (smoothstep(0.05, 0.0, abs(abs(fuw) - hw - 0.03)) + smoothstep(0.05, 0.0, abs(fv - 0.14)));  alb *= 1.0 - 0.25 * se;
                    if (shaft && shaftLayer != 1) { float q2 = step(abs(abs(fu) - bw * 0.5), 0.0) ; alb *= 1.0 - 0.0 * q2; }
                  }
                  // a sill course on every storey of a stone front, a floor line on lofts
                  float course = smoothstep(0.07, 0.04, abs(fv - (y0 - 0.08))) * (isStone && !shaft ? 1.0 : 0.0); alb *= 1.0 + 0.10 * course;
                  if (isStone && H > 55.0 && layer == 1) { float fb_ = smoothstep(0.16, 0.10, abs(fv - 0.2)); alb *= 1.0 + 0.14 * fb_; alb *= 1.0 - 0.22 * smoothstep(0.05, 0.0, abs(fv - 0.02)); fNrmT.y += fb_ * 0.25 * sign(fv - 0.2);
                    float rj = smoothstep(0.035, 0.0, abs(fract(fv / 0.45) - 0.5) - 0.465); alb *= 1.0 - 0.16 * rj; }
                }
              }
              if (ribbon > 0.5 && hasWin) { alb *= 1.0 - 0.12 * smoothstep(0.02, 0.0, abs(fv - y0) - 0.02); }
              fAlb = alb; fRough = rough; fNrmT = normalize(fNrmT); return;
            }
            {
              if (secondary) depth = 0.14;
              vec2 q = vec2(fuw, fv) - par * depth;     // where the ray meets the glass plane
              float hwq = ribbon > 0.5 ? 1e3 : hw;
              if (abs(q.x) > hwq || q.y < y0 || q.y > y1) {
                // the reveal: jamb, head or sill of the opening, each turned its own way to the light
                vec3 rn = q.y > y1 ? vec3(0.0, -1.0, 0.15) : (q.y < y0 ? vec3(0.0, 1.0, 0.15) : vec3(-sign(q.x), 0.0, 0.15));
                { float din = q.y > y1 ? (q.y - y1) / max(abs(par.y), 0.05) : (q.y < y0 ? (y0 - q.y) / max(abs(par.y), 0.05) : (abs(q.x) - hwq) / max(abs(par.x), 0.05)); alb *= (q.y > y1 ? 0.55 : (q.y < y0 ? 0.95 : 0.7)) * mix(0.55, 1.0, clamp(din / depth, 0.0, 1.0)); } rough = 0.9;
                fAlb = alb; fRough = rough; fNrmT = normalize(rn + vec3(nt.xy * 0.3, 0.0)); return;
              }
              vec3 wallAlb = alb;
              vec2 wc = vec2(q.x, q.y - (y0 + y1) * 0.5); vec2 half_ = vec2(ribbon > 0.5 ? bw * 0.5 : hw, (y1 - y0) * 0.5);
              if (ribbon > 0.5) wc.x = (fract((u - par.x * depth) / bw) - 0.5) * bw;
              // the opening's own shadow on the glass and frame: the sun's ray from here must leave through the hole
              vec2 sq = q + spar * depth; float inSun = ribbon > 0.5 ? step(sq.y, y1) : step(abs(sq.x), hw) * step(y0, sq.y) * step(sq.y, y1);
              fShade = mix(0.12, 1.0, inSun) * step(0.02, st3.z) + (1.0 - step(0.02, st3.z));
              if (style < 2.5 && wc.y < 0.02) fShade *= mix(1.0, 0.25, step(0.02 - 0.05 * max(spar.y, 0.0), wc.y) * step(0.02, st3.z));   // the lower sash sits behind the upper: the meeting rail shades a band of it
              float pairS = 0.0;
${WIN_BODY}
              if (ribbon < 0.5 && !archTop) { float cw = clamp(0.5 - min(hw - abs(fuw), min(fv - y0, y1 - fv)) / fPx, 0.0, 0.5); alb = mix(alb, wallAlb, cw); fPane = mix(fPane, wallAlb, cw); fGlass *= 1.0 - cw; }
              { float ao = mix(0.55, 1.0, smoothstep(0.0, depth * 1.2, half_.y - wc.y)) * mix(0.75, 1.0, smoothstep(0.0, depth * 0.8, half_.x - abs(wc.x))); alb *= ao; fPane *= ao; }
              fAlb = alb; fRough = rough; return;
            }
          }

          // ---------------- the street floor
          float shopN = glassTower ? 6.0 : (style > 3.5 ? 2.0 : (style > 0.5 && style < 1.5 ? 2.0 : 3.0));
          float shopW = bw * shopN;
          float sx = u / shopW; float si = floor(sx); float su = (fract(sx) - 0.5) * shopW;
          vec2 sid = vec2(si, floor(seed * 512.0)); vec3 sh3 = hash32(sid);
          float pierW = style > 0.5 && style < 1.5 ? 0.5 : 0.32;
          float pier = step(shopW * 0.5 - pierW, abs(su));
          float plinth = step(v, 0.42);
          float signLo = gh - 1.25, signHi = gh - 0.35;
          bool blank = sh3.x < 0.14 && !glassTower;      // a plain wall / service bay
          if (pier > 0.5 || v > signHi || blank) {
            if (glassTower) { alb = vec3(0.12); rough = 0.4; fMetal = 0.7; }
            else if (style > 0.5 && style < 1.5) { float j = smoothstep(0.03, 0.0, abs(fract(v / 0.55) - 0.5) - 0.47); alb *= 1.0 - 0.4 * j; fNrmT.y += j * 0.4; }
            if (blank && pier < 0.5 && v < signLo && abs(su) < 1.3 && v < 2.6) { alb = vec3(0.16, 0.17, 0.18) * (0.8 + 0.2 * step(0.5, fract(v * 9.0))); rough = 0.5; fMetal = 0.6; }   // roll-down gate
            fAlb = alb * (plinth > 0.5 ? 0.6 : 1.0); fRough = rough; fNrmT = normalize(vec3(nt.xy + fNrmT.xy, 1.0)); return;
          }
          if (v > signLo) {
            // the sign board
            float row = floor(hash21(sid + 1.0) * 31.99);
            vec2 suv = vec2(su / (shopW - 2.0 * pierW) + 0.5, (v - signLo) / (signHi - signLo));
            float aspect = (shopW - 2.0 * pierW) / (signHi - signLo) / 16.0;      // atlas rows are 16:1
            suv.x = (suv.x - 0.5) * max(aspect, 1.0) + 0.5;
            vec3 sc = texture(tSign, vec2(clamp(suv.x, 0.004, 0.996), 1.0 - (row + 1.0 - clamp(suv.y, 0.04, 0.96)) / 32.0)).rgb;
            if (suv.x < 0.0 || suv.x > 1.0) sc = texture(tSign, vec2(0.004, 1.0 - (row + 0.5) / 32.0)).rgb;
            if (sh3.y < 0.18 || (style > 0.5 && style < 1.5 && sh3.y < 0.6)) sc = (style > 0.5 && style < 1.5) ? alb * 1.05 : vec3(0.09, 0.09, 0.1);            // no sign: dark fascia, or the stone itself
            fAlb = sc * (0.75 + 0.2 * grime); fRough = 0.55; return;
          }
          // shop glass
          { float sdepth = 0.12; vec2 q = vec2(su, v) - par * sdepth;
          float doorX = (sh3.z - 0.5) * (shopW - 2.6);
          float fr = step(shopW * 0.5 - pierW - 0.06, abs(q.x)) + step(q.y, 0.5) + step(signLo - 0.06, q.y) + step(abs(abs(q.x - doorX) - 0.55), 0.035) + step(abs(fract(q.x / 1.6) - 0.5), 0.012) * step(1.2, abs(q.x - doorX));
          if (plinth > 0.5) { fAlb = (glassTower ? vec3(0.1) : alb * 0.55); fRough = 0.7; return; }
          vec3 d = normalize(vec3(-par, 1.0));
          float lit = step(0.25, sh3.x);
          vec3 room = roomColor(vec2(q.x, q.y - gh * 0.5), d, vec2(shopW, gh), 7.0, sid, lit);
          // shelves / goods: coloured blocks on the back
          vec2 gq = vec2(q.x * 1.6 - par.x * 2.5, q.y * 2.2) + sid * 13.0; vec3 goods = vec3(vnoise(gq), vnoise(gq + 7.3), vnoise(gq + 19.1)) * 0.6 + 0.2 * vnoise(gq * 5.0);
          room = mix(room, room * (0.35 + goods * 0.9), 0.6 * step(q.y, 2.1) * step(0.45, fract(q.y * 0.9 + sh3.y)));
          room = room * 1.25 + lit * vec3(0.10, 0.085, 0.06) * smoothstep(0.8, 3.2, q.y);       // lit ceiling glow
          alb = room; rough = 0.06; fGlass = 1.0; fRefl = 2.0; fF0 = 0.09; fGT = vec3(0.72, 0.80, 0.77);
          { vec3 pj = hash32(sid + floor(q.x / 1.6) * 3.1); fNrmT = normalize(vec3((pj.xy - 0.5) * 0.02, 1.0)); fPane = vec3(0.40, 0.38, 0.34) * (0.02 + 0.05 * vnoise(q * vec2(1.5, 0.8) + sid) + 0.10 * smoothstep(0.5, 0.0, q.y - 0.5)); }
          if (fr > 0.5) { alb = glassTower ? vec3(0.3) : frameCol; rough = 0.45; fGlass = 0.0; fMetal = glassTower ? 0.8 : 0.0; }
          fAlb = alb; fRough = rough; }
        }`)
      .replace('#include <map_fragment>', `facade(); if (fAvg.x >= 0.0 && vLay2.x < 320.0) { float lodF = smoothstep(0.3, 0.8, max(fwidth(vFuv.x) / max(vLay.x, 0.5), fwidth(vFuv.y) / max(vLay.y, 2.4) * 1.5)); fAlb = mix(fAlb, fAvg, lodF * (1.0 - fGlass)); if (fGlass > 0.5 && lodF > 0.0) { fAlb = mix(fAlb, fAvg * 0.3, lodF); } fGlass *= 1.0 - 0.75 * lodF; fNrmT = normalize(mix(fNrmT, vec3(0.0, 0.0, 1.0), lodF)); fShade = mix(fShade, 1.0, lodF); }
        diffuseColor.rgb = mix(fAlb, fPane, fGlass); bakeV = vBake;`)
      .replace('#include <emissivemap_fragment>', `float gThru = 1.0;
        if (fGlass > 0.01) { vec3 mV = normalize(cameraPosition - vWPos); vec3 mN = normalize(fT * fNrmT.x + fB * fNrmT.y + fN * fNrmT.z); vec3 mR = reflect(-mV, mN);
          float fres = min(fF0 + (1.0 - fF0) * pow(1.0 - max(dot(mV, fN), 0.0), 3.0), 0.72);      // several glass surfaces: rises sooner than one
          // What the pane mirrors is built, not looked up: the cube is drawn at the eye and is far too coarse to hold a skyline in one pane. The mirrored ray is followed
          // across the street to the wall opposite: above that wall's roof line the sky (its colour from the cube's zenith, paler to the horizon, with clouds), below it the wall
          // itself in the sun or in this building's shadow, with its window grid. Each light's tilt and bow move that picture by metres, so no two panes show the same.
          float mOpen = smoothstep(0.5, 0.9, clamp(vBake.r * 2.0, 0.0, 1.0));      // a wall that sees much sky faces a square, not a street wall
          float mW = mix(24.0, 34.0, mOpen); float tR = mW / max(dot(mR, fN), 0.25);
          vec3 mQ = vWPos + mR * tR; float sS = dot(mQ, fT);
          vec2 wv = vec2(vnoise(vFuv * vec2(0.9, 0.5) + 3.0), vnoise(vFuv * vec2(0.6, 1.1) + 11.0)) - 0.5; wv += (vec2(vnoise(vFuv * vec2(7.0, 4.0)), vnoise(vFuv * vec2(5.0, 8.0) + 5.0)) - 0.5) * 0.12; float wvA = 0.08 + 0.15 * fFlat; if (fFlat > 0.5) wv += (vec2(vnoise(vFuv * vec2(3.1, 2.3) + 7.0), vnoise(vFuv * vec2(2.6, 3.4) + 13.0)) - 0.5) * 0.35; mQ.y += wv.y * wvA; sS += wv.x * wvA;      // glass56: old drawn glass on the brick flats: the picture wavers      // glass is never flat: across the street that is metres
          float aw = clamp(fwidth(mQ.y), 0.03, 30.0), awx = clamp(fwidth(sS), 0.03, 30.0);
          vec3 zen = min(texture(tStreet, vec3(0.03, 1.0, 0.02)).rgb, vec3(2.5)); float zl = dot(zen, vec3(0.3333)); zen = mix(zen, zl * vec3(0.45, 0.80, 1.45), 0.65);
          float el = clamp(mR.y + fNrmT.y * 4.0 + wv.y * 0.12, 0.0, 1.0);
          vec3 skyc = mix(zen * 1.25 + vec3(zl * (0.55 - 0.3 * fFlat)), zen * 0.9, smoothstep(0.0, 0.55 - 0.25 * fFlat, el));
          vec2 cd = mR.xz / (el + 0.22) * 1.1 + vec2(3.0, 7.0) + wv * 1.5; float cl = smoothstep(0.58, 0.80, 0.62 * vnoise(cd) + 0.38 * vnoise(cd * 2.7 + 5.0)) * smoothstep(1.5, 0.3, el);
          skyc = mix(skyc, vec3(zl) * vec3(2.3, 2.3, 2.35), cl * 0.75); if (fFlat > 0.5) skyc = mix(skyc, skyc * vec3(0.80, 0.95, 1.18), 0.6) * mix(0.44, 0.28, smoothstep(0.0, 0.5, el));      // glass59: a pane of sky was blank white
          vec3 lh = hash32(vec2(floor(sS / 16.0 + 0.37), floor(dot(vWPos, fN) / 30.0)));
          float oh = mix(19.0 + 12.0 * fFlat, 62.0, lh.x);
          float sunO = dot(uSunDir, -fN); float shTop = vWPos.y + vFst.y - vFuv.y - mW * uSunDir.y / max(sunO, 0.05);
          float litO = smoothstep(0.02, 0.2, sunO) * smoothstep(shTop - 1.5, shTop + 1.5, mQ.y);
          vec3 wcol = lh.z < 0.16 ? vec3(0.10, 0.12, 0.14) : (lh.y < 0.3 ? vec3(0.30, 0.13, 0.09) : (lh.y < 0.5 ? vec3(0.40, 0.31, 0.21) : (lh.y < 0.78 ? vec3(0.44, 0.41, 0.36) : vec3(0.24, 0.17, 0.13))));      // the block opposite: glass, red brick, buff brick, limestone or brownstone
          // the wall opposite, sharp enough to read: its own windows (dark, some with a blind down, each holding a little sky), a course at every floor
          float bayW = mix(2.6, 3.6, lh.y); vec2 gcell = vec2(sS / bayW, mQ.y / 3.5); vec2 gf = abs(fract(gcell) - 0.5);
          float gsx = clamp(awx / bayW, 0.012, 0.3), gsy = clamp(aw / 3.5, 0.012, 0.26); float gfar = smoothstep(2.5, 0.8, max(aw, awx));
          float gw = smoothstep(0.24 + gsx, 0.24 - gsx, gf.x) * smoothstep(0.30 + gsy, 0.30 - gsy, gf.y) * gfar;
          float gwh = hash21(floor(gcell) + vec2(floor(sS / 16.0 + 0.37), 3.0));
          float gcrs = smoothstep(0.035 + gsy, 0.035, 0.5 - gf.y) * gfar;
          vec3 wlit = uSunColor * litO * max(sunO, 0.0) * 0.4 + zen * 0.7 + vec3(zl) * 0.55; float nM = uStyleP[1].x + uStyleP[1].y; vec3 wl; vec4 opx = vec4(0.0);
          if (nM > 0.5) {      // glass34: the wall opposite is one of the game's own photographed fronts (the lane's panels), so a pane holds real masonry, real windows and their ornament
            float nW = uStyleP[1].x; float opl = (lh.y < 0.68 && nW > 0.5) ? floor(lh.y / 0.68 * nW * 0.999) : floor(fract(lh.y * 7.31) * nM * 0.999); vec4 om = uPanel[int(opl)]; vec2 ow = vec2(om.x * om.z, om.y * om.w); vec2 op = vec2(sS / ow.x + lh.x, (mQ.y - 4.5) / ow.y);
            opx = textureGrad(tPanel, vec3(fract(op.x), 1.0 - fract(op.y), opl), vec2(min(awx * 1.4 / ow.x, 0.2), 0.0), vec2(0.0, min(aw * 1.4 / ow.y, 0.2)));
            wlit = uSunColor * litO * max(sunO, 0.0) * 0.6 + zen * mix(1.6, 0.8, litO) + vec3(zl) * mix(1.25, 0.6, litO);      // a shaded street wall is lit by the sunlit one it faces as well as by the sky (glass51: back to glass46's light; the neutral light of glass47-50 washed the oblique view's panes out)      // a shaded street wall is lit by the sunlit one it faces as well as by the sky
            { vec3 oc = opx.rgb; oc = mix(oc * oc * 2.1, oc, 0.2); oc = mix(vec3(dot(oc, vec3(0.3333))), oc, 0.8); wl = oc * mix(vec3(0.40), vec3(0.95), lh.z) * mix(1.5, 1.0, litO) * wlit; }
            { vec3 oh3 = hash32(floor(vec2(op.x * om.x, op.y * om.y)) + lh.xy * 91.0); float osky = oh3.x * oh3.x;      // its windows: most dark, some holding a strip of sky, some with a shade let down
              vec3 owin = vec3(0.012) * wlit + skyc * mix(0.06 + 0.55 * osky, 0.012 + 0.10 * osky, litO);
              wl = mix(wl, owin, opx.a * 0.95); }
                      } else {
          wl = wcol * wlit * mix(1.0, mix(0.10, 0.6, step(0.72, gwh) * step(0.2 + 2.0 * (1.0 - gwh), fract(gcell.y))), gw) * (1.0 - 0.3 * gcrs) * (0.75 + 0.5 * vnoise(vec2(sS, mQ.y) * 0.21));
          { vec2 gin = vec2(0.24 - gf.x, 0.30 - gf.y); float gfr = gw * (1.0 - smoothstep(0.035 - gsx, 0.035 + gsx, min(gin.x, gin.y * 1.2))); float gcr = gw * max(smoothstep(0.016 + gsx, 0.016 - gsx, gf.x), smoothstep(0.016 + gsy, 0.016 - gsy, abs(gf.y - 0.02))); wl = mix(wl, wcol * wlit * 0.55, max(gfr, gcr * 0.8) * step(lh.z, 0.6)); }
          { float gsill = smoothstep(0.24 + gsx + 0.03, 0.24 + 0.03 - gsx, gf.x) * smoothstep(0.035 + gsy, 0.035 - gsy, abs(fract(gcell.y) - 0.17)) * gfar; wl *= 1.0 + 0.45 * gsill;
            float ctop = oh - mQ.y; float csh = smoothstep(aw, -aw, abs(ctop - 1.7) - 0.35), clip = smoothstep(aw, -aw, abs(ctop - 0.6) - 0.6); wl *= (1.0 - 0.5 * csh * (1.0 - clip)) * (1.0 - 0.12 * clip); wl = mix(wl, wl * (1.0 - 0.5 * gw), 0.0); }
          wl += skyc * mix(0.30, 0.10, litO) * gw * (1.0 - step(0.72, gwh)); }
          { // its street floor: dark shop glass between piers under a fascia in the shop's colour
            float sx2 = sS / (bayW * 2.0); float fas = smoothstep(aw, -aw, abs(mQ.y - 3.6) - 0.45);
            vec3 shopc = mix(vec3(0.05, 0.055, 0.06) * wlit, wl * 0.75, max(smoothstep(0.43 - gsx, 0.43 + gsx, abs(fract(sx2) - 0.5)), fas * 0.6));
            wl = mix(wl, shopc, smoothstep(4.6 + aw + 0.5, 3.8 - aw, mQ.y)); }      // in a shaded wall its windows are the bright thing: they hold the sky
          float awR = aw * (1.0 + 2.0 * fFlat) + 0.5 * fFlat; vec3 rc = mix(skyc, wl, 1.0 - smoothstep(oh - awR, oh + awR, mQ.y));
          if (fRefl > 1.5) { if (mQ.y < 5.0) {      // shop glass: the street itself from the cube, aimed at the point the ray reaches
            float tG = mR.y < -0.01 ? min(tR, max(vWPos.y, 0.5) / -mR.y) : tR;
            rc = mix(min(texture(tStreet, vWPos + mR * tG - cameraPosition).rgb, vec3(2.5)), rc, smoothstep(2.5, 5.0, mQ.y)); } }
          else rc = mix(vec3(0.085, 0.085, 0.09) * (uSunColor * 0.25 * step(0.02, sunO) + zen * 0.6 + vec3(zl) * 0.4), rc, smoothstep(-0.2, 0.3, mQ.y));      // upper windows looking down: the roadway
          // lead, item 16 v2 (Nov 10 23:20): upper windows mirrored a drawn stand-in wall; within reach of the live street cube they now mirror the
          // REAL buildings across the street: the cube is looked up toward the point the mirrored ray reaches (as shop glass already did), and
          // the stand-in takes over again with distance from the eye, where one eye-centred cube points at the wrong stretch of street. ?realrefl=0 = off.
          if (fRefl <= 1.5) { vec3 rr = min(texture(tStreet, vWPos + mR * tR - cameraPosition).rgb, vec3(2.5)); float rk = float(REALREFL) * (1.0 - smoothstep(70.0, 150.0, distance(vWPos, cameraPosition))) * smoothstep(-0.25, 0.05, mR.y + 0.2); rc = mix(rc, rr, rk); }
          float mAmt = fRefl > 1.5 ? 1.0 : 0.55 + 0.75 * fRefl; rc = mix(rc, skyc * 0.9, fVeil);      // no two lights are equally clean or equally coated
          fEmis += rc * 0.85 * mix(vec3(1.0), fGT, 0.4) * fres * fGlass * mAmt * (1.0 - 2.5 * fDirt); gThru = 1.0 - fres * fGlass; diffuseColor.rgb *= gThru; }
        totalEmissiveRadiance = fAlb * fGlass * 0.55 * (0.35 + 0.65 * clamp(vBake.r * 1.5, 0.0, 1.0)) * gThru + fEmis;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = fRough;`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = fMetal;`)
      .replace('#include <normal_fragment_maps>', `{ vec3 wn = normalize(fT * fNrmT.x + fB * fNrmT.y + fN * fNrmT.z); bakeN = fN; normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor = mix(material.specularColor, vec3(0.05), fGlass); material.specularF90 = 1.0 - 0.92 * fFrm * (1.0 - fGlass); material.specularColor *= 1.0 - 0.7 * fFrm * (1.0 - fGlass);`)
      .replace('#include <aomap_fragment>', BAKE_LIGHT_GLSL + ' { vec3 gR = reflect(-normalize(cameraPosition - vWPos), bakeN); reflectedLight.indirectSpecular *= mix(1.0, mix(0.0, 0.15, smoothstep(0.12, 0.6, gR.y)), max(fGlass, fRough < 0.2 ? 1.0 : 0.0)); } { float sT = 1.0 - min(0.08 + 0.92 * pow(1.0 - clamp(dot(uSunDir, fN), 0.0, 1.0), 3.0), 1.0); reflectedLight.directDiffuse *= fShade * mix(1.0, sT * sqrt(sT), fGlass); } reflectedLight.directSpecular *= fShade;      // at a grazing sun the glass throws most of it back: what stands behind is barely lit');
  };
  m.customProgramCacheKey = () => 'facade-l27-glass61';
  return m;
}
