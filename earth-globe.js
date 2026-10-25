/* ============================================================================
   earth-globe.js — интерактивная процедурная модель Земли (Three.js r160, ES-модуль)
   ----------------------------------------------------------------------------
   Без внешних текстур: континенты рисуются из грубых контуров в canvas-маску,
   океан, атмосфера, штормы, течения и сетка — шейдеры/геометрия.
   ============================================================================ */

import * as THREE from 'three';

/* ============================================================================
   1. МАТЕМАТИКА КООРДИНАТ
   ============================================================================ */

export function latLonToVector3(lat, lon, radius = 1, target = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return target.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

/* ============================================================================
   2. ФОРМА: сфера → эллипсоид → гиперболизированный геоид
   ============================================================================ */

const BUMPS = [
  [-6, 78, -0.055, 26],
  [62, -22, 0.045, 22],
  [-4, 145, 0.05, 20],
  [-16, -70, 0.04, 13],
  [-75, 0, -0.035, 22],
  [10, 125, 0.03, 14],
  [-5, -120, -0.025, 25],
  [0, 15, 0.025, 25],
].map(([lat, lon, amp, sig]) => ({
  dir: latLonToVector3(lat, lon, 1),
  amp,
  s: 1 - Math.cos(THREE.MathUtils.degToRad(sig)),
}));
const NB = BUMPS.length;

const GLSL_SURFACE = /* glsl */ `
uniform float uMorph;
uniform float uFlat;
uniform float uGeoAmp;
uniform vec3  uBDir[${NB}];
uniform float uBAmp[${NB}];
uniform float uBS[${NB}];

float undulation(vec3 d){
  float u = 0.0;
  for (int i = 0; i < ${NB}; i++) u += uBAmp[i] * exp(-(1.0 - dot(d, uBDir[i])) / uBS[i]);
  u += 0.012 * (sin(2.3*d.x + 1.1) * cos(1.9*d.z - 0.4) + sin(3.1*d.y + 0.7) * cos(2.2*d.x));
  return u;
}
vec3 surfacePoint(vec3 d){
  float e = clamp(uMorph, 0.0, 1.0);
  float g = clamp(uMorph - 1.0, 0.0, 1.0);
  vec3 p = d * vec3(1.0, mix(1.0, 1.0 - uFlat, e), 1.0);
  return p + d * undulation(d) * uGeoAmp * g;
}
vec3 surfaceNormal(vec3 d){
  vec3 up = abs(d.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 t1 = normalize(cross(up, d));
  vec3 t2 = cross(d, t1);
  float e = 0.002;
  vec3 p0 = surfacePoint(d);
  vec3 p1 = surfacePoint(normalize(d + t1 * e));
  vec3 p2 = surfacePoint(normalize(d + t2 * e));
  return normalize(cross(p1 - p0, p2 - p0));
}
vec3 displace(vec3 p){
  vec3 d = normalize(p);
  return p + (surfacePoint(d) - d);
}`;

const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.875; }
float fbm5(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.969; }
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }`;

/* ============================================================================
   3. ПРОЦЕДУРНАЯ МАСКА СУШИ 
   ============================================================================ */
const LAND = [
  [[-9,37],[-9,43],[-2,43.5],[-1.5,46],[-4.5,48.5],[-1.5,49.5],[2,51],[4,52],[8,54],[8.5,57],[10.5,57.7],[11,59],[5.5,58.5],[5,62],[10,64],[14,67.5],[19,70],[25,71],[31,70.2],[33,69.4],[37,68.5],[41,67.1],[41,66],[34,66.5],[33,64.5],[37,64],[40,64.5],[44,66],[44,68],[54,68.5],[60,69],[68,69],[73,68],[69,73],[80,73],[87,75],[100,77.5],[105,77],[112,74],[128,73],[140,72.5],[150,71.5],[160,69.5],[170,70],[180,69],[180,65],[178,64.5],[170,60],[163,59.5],[162,56],[156.5,51],[156,57],[160,61.5],[155,59.5],[143,59],[137,54],[141,52],[140,48],[135,43],[131,42.5],[129,41],[129,37],[126,35],[126.5,37.5],[125,39.5],[121,39],[122,37],[119,37],[121,33],[122,30],[120,26],[116,23],[110,21],[108,21.5],[106,19],[109,15],[109,11.5],[105,9],[103,10.5],[100,13.5],[99,10],[100,6],[103,2],[104,1.5],[101,3],[98,8],[98,15],[94,17],[92,22],[90,22],[87,21],[85,19],[80,15],[80,10],[77.5,8],[76,10],[73,17],[72.5,21],[69,22.5],[67,24.5],[62,25],[57,25.5],[56.5,27],[51,28],[48,30],[50,26],[51.5,24.5],[56,26],[56.5,24],[59.5,22.5],[57,19],[52,16.5],[45,13],[43,13],[43,16],[39,21],[35,28],[34.5,28],[32.5,30],[34,31.5],[35.5,33.5],[36,36],[33,36.5],[30,36.5],[27,37],[26.5,40],[29,41],[26,40.5],[23,40],[24,38],[22,36.5],[21,38],[19.5,40.5],[19,42],[15.5,45],[13.5,45.5],[12.5,44],[16,41.9],[18.5,40.2],[16.5,38],[15.7,40],[12,42],[10,44],[7,43.5],[3.5,43],[3,42],[0,39],[-0.5,37.5],[-2,36.8],[-5.5,36],[-9,37]],
  [[-5.5,35.8],[-2,35],[3,36.8],[10,37.2],[11,35],[10,33.5],[15,32.3],[20,30.8],[20,32.5],[23,32.5],[29,31],[32.5,31.2],[32.5,30],[33,28],[35,24],[37.5,18],[39,15.5],[43,12.5],[44,10.5],[51,12],[51,10.5],[48,5],[42,-1],[40,-3],[39,-6],[40.5,-10.5],[40.5,-15],[35,-20],[35.5,-24],[32.5,-26],[32,-29],[27,-33.5],[20,-34.8],[18.5,-34],[17.5,-30],[15,-26],[14,-22],[12,-17],[13.5,-12],[12,-6],[9,-1],[9.5,3.5],[6,4.3],[4,6.3],[-2,4.8],[-7.5,4.4],[-13,8],[-17,14.7],[-16.5,20],[-13,27.5],[-10,29.5],[-9.5,32],[-6.5,34]],
  [[-168,65.5],[-162,70],[-156,71.3],[-141,69.7],[-128,70],[-115,68],[-108,68.5],[-95,68.5],[-90,69],[-82,69.5],[-81,67],[-86,66],[-88,64],[-93,61],[-94.5,59],[-92.5,57],[-85,55.5],[-82,53],[-79,52],[-79,55],[-77,57],[-77.5,60],[-78,62.5],[-73,62],[-69.5,59],[-65,60],[-62,57.5],[-57,54],[-56,51.5],[-60,50],[-66,50],[-70,47],[-64.5,48.8],[-64,46],[-61,45.5],[-66,43.8],[-70,43.5],[-70.5,41.8],[-74,40.5],[-76,37],[-76,35],[-78,34],[-81,31.5],[-80,26],[-80.5,25.2],[-82,26.5],[-83,29.5],[-85,29.7],[-89,30.2],[-90,29],[-94,29.5],[-97.2,27.5],[-97.5,22],[-96,19],[-94.5,18.2],[-91,18.7],[-90.5,21],[-87,21.5],[-87.5,18],[-88.5,16],[-84,15.8],[-83.5,11],[-81.5,8.7],[-79,9.5],[-77.3,8.5],[-75.5,10.5],[-72,12],[-71,11],[-68,10.5],[-62,10.7],[-60,8.5],[-57,6],[-52,5],[-50,1.5],[-50,-1],[-44,-2.5],[-39,-3.5],[-35,-5.5],[-35,-9],[-39,-13.5],[-39,-18],[-41,-22],[-45,-23.5],[-48,-26],[-48.5,-28.5],[-52,-33],[-54,-34.5],[-58,-34.5],[-57,-37],[-62,-39],[-65,-41],[-63.5,-42.5],[-65.5,-45],[-67.5,-46.5],[-66,-48],[-69,-51],[-68.5,-52.5],[-70,-53],[-68,-55],[-67.3,-55.9],[-72,-54.5],[-75,-50],[-75.5,-46],[-73.5,-42],[-73.5,-37],[-71.5,-32],[-71.5,-28],[-70.3,-23],[-70.3,-18.5],[-76,-14],[-79,-8],[-81.3,-5],[-80,-2],[-80.5,0],[-78.7,2.5],[-77.5,6],[-78.5,8.3],[-80,7.4],[-81.8,8],[-85.5,10],[-87.5,13],[-91.5,14],[-94.5,16],[-97,15.8],[-101,17.5],[-105.5,20],[-105.5,23],[-107.5,25],[-109.5,27],[-112.5,30],[-114.7,31.7],[-114,29],[-112,27],[-110,23],[-112,24.5],[-114.5,27.7],[-115.8,29.7],[-117,32.5],[-120.5,34.5],[-122.5,37.5],[-124,40.5],[-124,46.5],[-123,48.3],[-125,50],[-130,54.5],[-134,58],[-139,59.8],[-146,60.8],[-152,59],[-154,57.5],[-158,56],[-162,55],[-157.5,58.5],[-162,59.5],[-165,61],[-166,62.5],[-161,64.5]],
  [[-73,78],[-60,82],[-30,83.5],[-20,81],[-18,77],[-22,70],[-32,68],[-41,63],[-44,60],[-49,61],[-52,65],[-54,69],[-58,75.5],[-70,77]],
  [[-80,73.5],[-70,71],[-62,67],[-65,63],[-72,64],[-78,65],[-88,69.5],[-85,73]],
  [[-90,76.5],[-80,76],[-62,82],[-75,83],[-90,81]],
  [[-118,72],[-105,73],[-100,70],[-115,69]],
  [[-24,65.5],[-22,66.4],[-15,66.4],[-13.5,65],[-18,63.4],[-22.5,63.8]],
  [[-5.7,50],[1.5,51],[1.7,52.8],[-0.5,54],[-2,55.8],[-2,57.6],[-3.5,58.6],[-5,58.6],[-6,56.5],[-5,54.7],[-3,54],[-3.2,53.3],[-4.5,53.3],[-5,51.7]],
  [[-10,51.7],[-6,52],[-6,54.2],[-7.5,55.2],[-10,54]],
  [[11,78.5],[17,80],[27,80.2],[20,77.5],[15,77]],
  [[51.5,71.5],[56,74.5],[68,77],[60,75],[56,71.5],[52,70.8]],
  [[12.4,38],[15.6,38.2],[15.1,36.7],[12.5,37.6]],
  [[8.2,41],[9.7,41],[9.5,39],[8.5,39]],
  [[-85,22],[-82,23.2],[-77,21.5],[-74,20],[-77.5,19.8],[-80,21.8]],
  [[-74.4,18.5],[-72,19.9],[-68.5,18.6],[-71,17.8]],
  [[130.9,33.9],[134,34.6],[135,33.5],[137,34.6],[140,35],[141,38],[142,40.5],[141.2,41.4],[139.8,39.5],[138,37.5],[136,36],[133,35.5],[131,34.4]],
  [[140,42],[141.5,45.4],[145,43.3],[143,42],[140.5,41.5]],
  [[129.7,33.2],[131.8,33.5],[131.5,31.2],[130.2,31]],
  [[142,46],[143.5,49],[143,54],[142,53],[142,49]],
  [[120.2,23],[121.5,25.2],[122,24.5],[121,22]],
  [[120.5,18.5],[122.2,18.5],[122,16],[124,13],[121,13.8],[120,16]],
  [[122,7],[125.5,9.5],[126.5,7],[125.5,5.8],[123,7.5]],
  [[109,1.5],[111,2],[114,4.5],[117,7],[119,5],[117.5,1],[116.5,-3.5],[114,-3.5],[110.5,-3],[109.2,-1]],
  [[95.3,5.5],[98,4],[103.5,-0.5],[106,-3],[105.8,-5.9],[102,-4],[98.5,0.5],[96,2.5]],
  [[105.2,-6.8],[108,-6.5],[112.5,-6.8],[114.5,-7.8],[110,-8.2],[106,-7.5]],
  [[119.5,-5.5],[120.5,-2.8],[121,1],[125,1.5],[123,0.5],[122,-1.5],[123,-4.5],[121,-4],[120.5,-5.5]],
  [[131,-1],[135,-3.2],[138,-1.8],[141,-2.6],[145.7,-5],[147.3,-6],[150,-10.5],[147,-10],[143.5,-8.5],[141,-9.1],[138,-8.3],[137.5,-5],[134,-4],[132,-2.8]],
  [[113.5,-22],[114,-26],[115,-34],[118,-35],[123,-34],[129,-31.5],[132,-32],[135.5,-35],[138,-35.5],[140,-37.7],[146,-39],[150,-37.5],[153,-31],[153.5,-25.5],[149,-21],[146,-18.5],[145.4,-14.8],[143.5,-14],[142.5,-10.7],[141.5,-13.5],[140.8,-17.5],[137,-15.8],[135.5,-14.7],[136.8,-12],[132.5,-11.3],[130,-13],[127,-14],[125,-15],[122.2,-17.5],[121,-19.5],[117,-20.8]],
  [[144.7,-40.7],[148.3,-40.9],[147.8,-43.2],[146,-43.5]],
  [[172.7,-34.5],[175.5,-37],[178.5,-37.7],[176,-41.5],[174.5,-39.5],[173,-35]],
  [[172.7,-40.5],[174.3,-41.7],[172.5,-43.7],[170.5,-46],[166.5,-46],[168,-44],[171,-42.3]],
  [[79.8,9.8],[81.8,7.5],[81,6],[80,6.2],[79.8,8]],
  [[49.3,-12],[50.5,-15.5],[49.5,-19],[47.5,-25],[45,-25.5],[43.5,-22],[44.5,-17],[47,-15]],
  [[-180,-78],[-165,-78.5],[-150,-76.5],[-120,-74],[-100,-72.5],[-80,-73.5],[-72,-70],[-65,-66],[-60,-63.5],[-56,-63.3],[-60,-65.5],[-62,-69],[-58,-73],[-45,-78],[-30,-78.5],[-20,-72.5],[0,-70],[20,-70],[40,-68.5],[60,-67.5],[70,-69.5],[80,-67],[100,-66.5],[120,-66.5],[140,-66.5],[150,-69],[165,-71.5],[170,-77],[180,-78],[180,-90],[-180,-90]],
];
const SEAS = [
  [[10.8,54],[14,53.9],[19,54.4],[21.2,56],[21,57.6],[24,57.2],[24.5,59.2],[30,59.9],[25,60.4],[22,60.2],[21.5,61.2],[21.3,63],[25.2,65],[24,65.7],[21.5,65.2],[17.3,62.2],[18.8,60],[16.8,57.5],[16,56.2],[14.3,55.4],[12.8,55.6],[12,56.4],[12,55],[11,54.5]],
  [[28,41.8],[28.5,43.5],[30,45.3],[33,46],[35,45.2],[36.7,45.5],[38,47],[40,45],[41.5,42],[38,41],[34,42],[31,41.2]],
  [[47,45],[50,46.5],[53,46.5],[53.5,44],[51,42],[53,40],[54,37.5],[50,37],[49,40],[47.5,42]],
];

function makeLandTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const trace = (poly) => {
    g.beginPath();
    poly.forEach(([lo, la], i) => {
      const x = ((lo + 180) / 360) * W, y = ((90 - la) / 180) * H;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.closePath();
  };
  g.fillStyle = '#fff'; LAND.forEach((p) => { trace(p); g.fill(); });
  g.fillStyle = '#000'; SEAS.forEach((p) => { trace(p); g.fill(); });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/* ============================================================================
   4. ШЕЙДЕРЫ
   ============================================================================ */

const PLANET_VS = /* glsl */ `
${GLSL_SURFACE}
varying vec3 vDir; varying vec3 vNormalW; varying vec3 vPosW; varying float vUnd;
void main(){
  vec3 d = normalize(position);
  vec3 sp = surfacePoint(d);
  vDir = d; vUnd = undulation(d) * uGeoAmp;
  vNormalW = normalize(mat3(modelMatrix) * surfaceNormal(d));
  vec4 wp = modelMatrix * vec4(sp, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PLANET_FS = /* glsl */ `
${GLSL_NOISE}
uniform sampler2D uLand; uniform vec3 uSun; uniform float uTime; uniform float uMorph;
varying vec3 vDir; varying vec3 vNormalW; varying vec3 vPosW; varying float vUnd;

float stormBand(float latD){ return smoothstep(-65.0, -58.0, latD) * (1.0 - smoothstep(-42.0, -36.0, latD)); }

vec3 geoidRamp(float t){
  vec3 c0 = vec3(0.05, 0.12, 0.85), c1 = vec3(0.05, 0.85, 0.9), c2 = vec3(0.2, 0.9, 0.25), c3 = vec3(1.0, 0.9, 0.1), c4 = vec3(1.0, 0.15, 0.1);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

void main(){
  vec3 d = normalize(vDir);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float latD = degrees(lat);
  float lon = atan(-d.z, d.x);
  vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.14159265 + 0.5);

  float land = texture2D(uLand, uv).r;
  vec2 o = vec2(4.0 / 2048.0, 4.0 / 1024.0);
  float b1 = (land + texture2D(uLand, uv + vec2(o.x, 0.)).r + texture2D(uLand, uv - vec2(o.x, 0.)).r
                   + texture2D(uLand, uv + vec2(0., o.y)).r + texture2D(uLand, uv - vec2(0., o.y)).r) / 5.0;
  vec2 o2 = o * 3.5;
  float b2 = (land + texture2D(uLand, uv + vec2(o2.x, 0.)).r + texture2D(uLand, uv - vec2(o2.x, 0.)).r
                   + texture2D(uLand, uv + vec2(0., o2.y)).r + texture2D(uLand, uv - vec2(0., o2.y)).r) / 5.0;

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uSun);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.08, 0.35, ndl);
  float sb = stormBand(latD);

  /* ----- Океан ----- */
  vec3 pw = d * 55.0 + vec3(0.0, uTime * 0.35, uTime * 0.2);
  float e = 0.04;
  float h0 = fbm3(pw);
  vec3 grad = vec3(fbm3(pw + vec3(e, 0., 0.)) - h0, fbm3(pw + vec3(0., e, 0.)) - h0, fbm3(pw + vec3(0., 0., e)) - h0) / e;
  grad -= d * dot(grad, d);
  float waveAmp = 0.035 * (1.0 + 2.6 * sb);
  vec3 n = normalize(N - grad * waveAmp);

  vec3 deep = vec3(0.004, 0.032, 0.095), mid = vec3(0.012, 0.11, 0.24), shallow = vec3(0.05, 0.40, 0.46);
  vec3 oc = mix(deep, mid, smoothstep(0.2, 0.8, fbm3(d * 3.0 + 4.0)));
  oc = mix(oc, shallow, smoothstep(0.03, 0.4, b2) * 0.85); 
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  oc = mix(oc, vec3(0.16, 0.30, 0.55), fres * 0.6);
  float foam = smoothstep(0.62, 0.78, h0) * (0.12 + sb) + smoothstep(0.15, 0.55, b1) * (1.0 - smoothstep(0.55, 0.75, b1)) * 0.35;
  oc += foam * vec3(0.8, 0.9, 1.0) * 0.55;
  float ice = smoothstep(70.0, 79.0, abs(latD) + (fbm3(d * 8.0) - 0.5) * 10.0);
  oc = mix(oc, vec3(0.62, 0.74, 0.82), ice);
  vec3 H = normalize(L + V);
  float spec = (pow(max(dot(n, H), 0.0), 140.0) * 1.6 + pow(max(dot(n, H), 0.0), 18.0) * 0.12) * (1.0 - ice * 0.8);
  vec3 ocean = oc * (0.07 + 0.93 * lit) + vec3(1.0, 0.95, 0.85) * spec * lit;

  /* ----- Суша ----- */
  float n1 = fbm5(d * 9.0), n2 = fbm3(d * 32.0);
  vec3 forest = vec3(0.025, 0.10, 0.03), grass = vec3(0.09, 0.2, 0.05), sand = vec3(0.42, 0.34, 0.16), rock = vec3(0.19, 0.15, 0.12), tundra = vec3(0.24, 0.27, 0.19);
  float arid = smoothstep(8.0, 18.0, abs(latD)) * (1.0 - smoothstep(28.0, 40.0, abs(latD))) * smoothstep(0.35, 0.65, n1);
  vec3 lc = mix(forest, grass, n1);
  lc = mix(lc, sand, arid);
  lc = mix(lc, rock, smoothstep(0.55, 0.8, n2) * 0.55);
  lc = mix(lc, tundra, smoothstep(55.0, 66.0, abs(latD)));
  float snow = smoothstep(66.0, 76.0, abs(latD) + (n1 - 0.5) * 14.0);
  lc = mix(lc, vec3(0.78, 0.84, 0.9), snow);
  lc *= 0.75 + 0.5 * n2;
  vec3 landC = lc * (0.06 + 0.94 * lit);

  vec3 col = mix(ocean, landC, smoothstep(0.35, 0.65, land));

  /* ----- Оверлей геоида: цветовая карта + изолинии ----- */
  float g = clamp(uMorph - 1.0, 0.0, 1.0);
  if (g > 0.001){
    float t = vUnd / 0.12 + 0.5;
    vec3 gc = geoidRamp(t);
    col = mix(col, gc * (0.25 + 0.9 * lit), g * 0.5);
    float s = vUnd * 130.0;
    float line = 1.0 - smoothstep(0.0, fwidth(s) * 1.3, abs(fract(s) - 0.5) - 0.44 + fwidth(s) * 0.65);
    col += vec3(1.0) * clamp(line, 0.0, 1.0) * g * 0.18 * (0.3 + lit);
  }

  /* ----- Атмосферная кайма ----- */
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.2, 0.5, 1.0) * rim * (0.2 + 0.8 * lit) * 0.85;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ATMO_VS = /* glsl */ `
varying vec3 vN; varying vec3 vP;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const ATMO_FS = /* glsl */ `
uniform vec3 uSun;
varying vec3 vN; varying vec3 vP;
void main(){
  vec3 N = normalize(vN), V = normalize(cameraPosition - vP);
  float a = abs(dot(N, V));
  float k = clamp(a / 0.45, 0.0, 1.0);
  float inten = pow(k, 3.0);
  float sunf = 0.12 + 0.9 * smoothstep(-0.35, 0.45, dot(N, normalize(uSun)));
  vec3 col = mix(vec3(0.08, 0.3, 0.9), vec3(0.45, 0.8, 1.0), k);
  col = mix(col, vec3(1.0, 0.55, 0.3), (1.0 - smoothstep(-0.1, 0.25, dot(N, normalize(uSun)))) * smoothstep(-0.4, -0.05, dot(N, normalize(uSun))) * 0.5);
  gl_FragColor = vec4(col, inten * sunf);
  #include <colorspace_fragment>
}`;

const LINE_VS = /* glsl */ `
${GLSL_SURFACE}
attribute float aT; uniform float uAlt; varying float vT;
void main(){
  vT = aT;
  vec3 sp = displace(position * (1.0 + uAlt));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(sp, 1.0);
}`;
const TUBE_VS = /* glsl */ `
${GLSL_SURFACE}
varying float vT;
void main(){
  vT = uv.x;
  vec3 sp = displace(position);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(sp, 1.0);
}`;
const LINE_FS = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uDash; uniform float uPulse; uniform float uTime;
varying float vT;
void main(){
  float dash = mix(1.0, step(0.5, fract(vT * uDash)), step(0.5, uDash));
  float pulse = mix(1.0, 0.55 + 0.45 * sin(vT * 62.83 - uTime * 2.2), uPulse);
  gl_FragColor = vec4(uColor, uAlpha * dash * pulse);
  #include <colorspace_fragment>
}`;

const STORM_VS = /* glsl */ `
${GLSL_SURFACE}
uniform float uAlt; varying vec3 vDir; varying vec3 vNW;
void main(){
  vec3 d = normalize(position);
  vDir = d;
  vNW = normalize(mat3(modelMatrix) * d);
  vec3 sp = displace(d * (1.0 + uAlt));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(sp, 1.0);
}`;
const STORM_FS = /* glsl */ `
${GLSL_NOISE}
uniform float uTime; uniform vec3 uSun;
varying vec3 vDir; varying vec3 vNW;
void main(){
  vec3 d = normalize(vDir);
  float latD = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float band = smoothstep(-65.0, -58.0, latD) * (1.0 - smoothstep(-42.0, -36.0, latD));
  if (band < 0.01) discard;
  float f50 = smoothstep(-48.0, -53.0, latD);
  float ang = uTime * (0.05 + 0.035 * f50);
  vec3 p = rotY(d * 4.0, -ang);
  vec3 w = vec3(vnoise(p * 2.1 + 3.0), vnoise(p * 2.1 + 9.0), vnoise(p * 2.1 + 5.0)) - 0.5;
  float cloud = fbm5((p + w * 0.7) * 2.2 + vec3(0.0, uTime * 0.03, 0.0));
  float c = smoothstep(0.38, 0.75, cloud);
  float flash = step(0.985, hash13(floor(p * 9.0) + floor(uTime * 2.5))) * c * (0.5 + 0.5 * sin(uTime * 40.0));
  vec3 col = mix(vec3(0.50, 0.72, 0.84), vec3(0.95, 0.97, 1.0), c);
  col = mix(col, vec3(0.70, 0.62, 0.98), f50 * 0.38);
  col += flash * vec3(1.0, 0.92, 0.6) * 1.6;
  float lit = 0.3 + 0.7 * smoothstep(-0.15, 0.5, dot(normalize(vNW), normalize(uSun)));
  float alpha = band * c * (0.55 + 0.3 * f50) + flash * band * 0.4;
  gl_FragColor = vec4(col * lit, clamp(alpha, 0.0, 0.88));
  #include <colorspace_fragment>
}`;

const STORMP_VS = /* glsl */ `
${GLSL_SURFACE}
attribute float aLat; attribute float aLon; attribute float aSpd; attribute float aTrail; attribute float aSeed; attribute float aTone;
uniform float uTime; uniform float uScale; uniform float uAlt;
varying float vA; varying float vTone;
void main(){
  float lon = aLon + uTime * aSpd - aTrail * 0.05;
  float lat = aLat + 0.014 * sin(uTime * 0.7 * (0.5 + aSeed) + lon * 6.0 + aSeed * 20.0);
  float cl = cos(lat);
  vec3 d = vec3(cl * cos(lon), sin(lat), -cl * sin(lon));
  vec3 sp = displace(d * (1.0 + uAlt * (0.6 + aSeed)));
  vec4 mv = modelViewMatrix * vec4(sp, 1.0);
  gl_Position = projectionMatrix * mv;
  float sz = mix(0.010, 0.0035, aTrail) * (0.6 + aSeed);
  gl_PointSize = clamp(sz * uScale / -mv.z, 1.5, 22.0);
  vA = (1.0 - aTrail) * (0.55 + 0.45 * sin(uTime * 3.0 + aSeed * 50.0));
  vTone = aTone;
}`;
const SOFT_POINT_FS = /* glsl */ `
uniform vec3 uColA; uniform vec3 uColB;
varying float vA; varying float vTone;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(mix(uColA, uColB, vTone), a * a * vA);
  #include <colorspace_fragment>
}`;

const HORN_VS = /* glsl */ `
${GLSL_SURFACE}
attribute float aRad; attribute float aAng; uniform float uAlt;
varying float vRad; varying float vAng; varying vec3 vNW;
void main(){
  vRad = aRad; vAng = aAng;
  vec3 d = normalize(position);
  vNW = normalize(mat3(modelMatrix) * d);
  vec3 sp = displace(d * (1.0 + uAlt));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(sp, 1.0);
}`;
const HORN_FS = /* glsl */ `
uniform float uTime;
varying float vRad; varying float vAng; varying vec3 vNW;
void main(){
  float r = vRad;
  float spiral = 0.5 + 0.5 * sin(vAng * 3.0 - r * 15.0 + uTime * 2.4);
  float spiral2 = 0.5 + 0.5 * sin(vAng * 5.0 + r * 9.0 - uTime * 1.6);
  float edge = smoothstep(1.0, 0.78, r);
  float core = smoothstep(0.4, 0.0, r);
  float ring = smoothstep(0.92, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float pulse = smoothstep(0.9, 1.0, sin(r * 20.0 - uTime * 3.0));
  vec3 col = mix(vec3(1.0, 0.2, 0.1), vec3(1.0, 0.78, 0.3), spiral);
  float a = edge * (0.10 + 0.34 * spiral * (1.0 - r) + 0.18 * spiral2 * (1.0 - r) + 0.5 * core + pulse * 0.1) + ring * 0.85;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;
const HORNP_VS = /* glsl */ `
${GLSL_SURFACE}
attribute float aRad; attribute float aAng; attribute float aSeed; attribute float aTrail;
uniform vec3 uC; uniform vec3 uE; uniform vec3 uN; uniform float uAngR; uniform float uTime; uniform float uScale; uniform float uAlt;
varying float vA; varying float vTone;
void main(){
  float r = aRad;
  float b = aAng + uTime * (1.8 / (0.25 + r)) * 0.6 - aTrail * 0.28 + r * 5.0;
  float a = r * uAngR;
  vec3 d = normalize(uC * cos(a) + (uE * cos(b) + uN * sin(b)) * sin(a));
  vec3 sp = displace(d * (1.0 + uAlt));
  vec4 mv = modelViewMatrix * vec4(sp, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(mix(0.009, 0.0035, aTrail) * (0.6 + aSeed) * uScale / -mv.z, 1.5, 20.0);
  vA = (1.0 - aTrail) * (0.6 + 0.4 * sin(uTime * 4.0 + aSeed * 40.0));
  vTone = r;
}`;

const CURR_VS = /* glsl */ `
${GLSL_SURFACE}
uniform vec3 uPath[64];
uniform float uTime; uniform float uSpeed; uniform float uSize; uniform float uScale; uniform float uAlt; uniform float uWidth;
attribute float aOff; attribute float aSeed; attribute float aSide;
varying vec2 vDir2; varying float vFade;
vec3 pathAt(float t){
  float f = clamp(t, 0.0, 1.0) * 63.0;
  int i = int(floor(f));
  int j = min(i + 1, 63);
  return normalize(mix(uPath[i], uPath[j], fract(f)));
}
void main(){
  float t = fract(aOff + uTime * uSpeed * (0.8 + 0.4 * aSeed));
  vec3 a = pathAt(t);
  vec3 b = pathAt(min(t + 0.012, 1.0));
  vec3 a0 = pathAt(max(t - 0.006, 0.0));
  vec3 tang = normalize(b - a0);
  vec3 side = normalize(cross(a, tang));
  vec3 off = side * aSide * uWidth;
  vec3 sp = displace(normalize(a + off) * (1.0 + uAlt));
  vec3 sq = displace(normalize(b + off) * (1.0 + uAlt));
  vec4 mv = modelViewMatrix * vec4(sp, 1.0);
  vec4 c0 = projectionMatrix * mv;
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(sq, 1.0);
  gl_Position = c0;
  float asp = projectionMatrix[1][1] / projectionMatrix[0][0];
  vec2 dv = vec2((c1.x / c1.w - c0.x / c0.w) * asp, c1.y / c1.w - c0.y / c0.w);
  vDir2 = length(dv) > 1e-7 ? normalize(dv) : vec2(1.0, 0.0);
  gl_PointSize = clamp(uSize * uScale / -mv.z, 6.0, 64.0);
  vFade = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.92, 1.0, t));
}`;
const CURR_FS = /* glsl */ `
uniform vec3 uColor;
varying vec2 vDir2; varying float vFade;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  float a = dot(q, vDir2);
  float b = dot(q, vec2(-vDir2.y, vDir2.x));
  float head = (1.0 - smoothstep(-0.05, 0.09, abs(b) - (0.85 - a) * 0.55)) * smoothstep(-0.2, -0.1, a) * (1.0 - smoothstep(0.85, 0.95, a));
  float stem = (1.0 - smoothstep(0.07, 0.16, abs(b))) * smoothstep(-0.95, -0.85, a) * (1.0 - smoothstep(-0.15, -0.05, a));
  float glow = exp(-dot(q, q) * 3.5) * 0.35;
  float I = max(head, stem) + glow;
  float alpha = I * vFade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor * (1.0 + head * 0.6), alpha);
  #include <colorspace_fragment>
}`;

/* ============================================================================
   5. ДАННЫЕ: течения, маркеры с пасхалкой для Мурманска
   ============================================================================ */
const CURRENTS = [
  { id: 'gulfstream', color: [1.0, 0.5, 0.12], count: 150, speed: 0.045,
    way: [[25,-80],[27.5,-79.6],[31,-79.2],[34.5,-76.2],[38,-72],[40.5,-66],[42.5,-58],[45,-48],[48,-38],[52,-27],[56,-15],[58.5,-5],[60,5]] },
  { id: 'kuroshio', color: [1.0, 0.35, 0.65], count: 120, speed: 0.05,
    way: [[20,125],[24,123.5],[28,127.5],[31,131.5],[33.5,135.5],[35,139.5],[36,142.5],[38,146],[40,150]] },
];

const MARKERS = [
  { id: 'murmansk', lat: 68.96, lon: 33.08, color: 0xff2255, // Красный для сердечка
    title: 'Мурманск · МГТУ / МАУ', coords: '68.96° с. ш., 33.08° в. д.',
    note: '<b style="color:#ffb3c6">Дашуля, я тебя обожаю ❤️</b><br>Самый надежный ориентир в любом море!' },
  { id: 'pole', lat: 90, lon: 0, color: 0xe6f6ff,
    title: 'Северный полюс', coords: '90° с. ш.',
    note: 'Все меридианы сходятся, долготы нет, любое направление отсюда — на юг.' },
  { id: 'null', lat: 0, lon: 0, color: 0xffcc33,
    title: 'Точка отсчёта · Null Island', coords: '0° / 0°',
    note: 'Пересечение экватора и Гринвичского меридиана в Гвинейском заливе. Острова нет — только метеобуй.' },
  { id: 'horn', lat: -55.98, lon: -67.26, color: 0xff5a2a, layer: 'capeHorn',
    title: 'Мыс Горн', coords: '55.98° ю. ш., 67.26° з. д.',
    note: 'Пролив Дрейка, «Неистовые пятидесятые»: западные ветры без преград и волны 15–20 м. «Кладбище парусников».' },
];

/* ============================================================================
   6. ВСПОМОГАТЕЛЬНЫЕ ПОСТРОИТЕЛИ И ПАСХАЛКИ
   ============================================================================ */

function createHeartGeometry() {
  const x = 0, y = 0;
  const heartShape = new THREE.Shape();
  heartShape.moveTo( x + 5, y + 5 );
  heartShape.bezierCurveTo( x + 5, y + 5, x + 4, y, x, y );
  heartShape.bezierCurveTo( x - 6, y, x - 6, y + 7, x - 6, y + 7 );
  heartShape.bezierCurveTo( x - 6, y + 11, x - 2, y + 15.4, x + 5, y + 19 );
  heartShape.bezierCurveTo( x + 12, y + 15.4, x + 16, y + 11, x + 16, y + 7 );
  heartShape.bezierCurveTo( x + 16, y + 7, x + 16, y, x + 10, y );
  heartShape.bezierCurveTo( x + 7, y, x + 5, y + 5, x + 5, y + 5 );
  
  const geo = new THREE.ExtrudeGeometry( heartShape, { depth: 2, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.5, bevelThickness: 0.5 } );
  geo.center();
  geo.rotateX(Math.PI); // Переворачиваем, т.к. 2D координаты рисуются сверху вниз
  geo.scale(0.0015, 0.0015, 0.0015);
  return geo;
}

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeLabelSprite(text, color = '#dff6ff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = '700 40px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(2,10,20,0.85)'; g.strokeText(text, 256, 50);
  g.fillStyle = color; g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(0.46, 0.46 * 96 / 512, 1);
  s.renderOrder = 8;
  return s;
}

function buildPatchGeometry(lat, lon, angRad, rings = 22, seg = 72) {
  const c = latLonToVector3(lat, lon, 1);
  const east = new THREE.Vector3(0, 1, 0).cross(c).normalize();
  const north = new THREE.Vector3().crossVectors(c, east).normalize();
  const pos = [], rad = [], ang = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const a = (angRad * r) / rings;
    for (let s = 0; s <= seg; s++) {
      const b = (2 * Math.PI * s) / seg;
      const v = c.clone().multiplyScalar(Math.cos(a))
        .addScaledVector(east, Math.cos(b) * Math.sin(a))
        .addScaledVector(north, Math.sin(b) * Math.sin(a));
      pos.push(v.x, v.y, v.z); rad.push(r / rings); ang.push(b);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
    const i = r * (seg + 1) + s, j = i + seg + 1;
    idx.push(i, j, i + 1, i + 1, j, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRad', new THREE.Float32BufferAttribute(rad, 1));
  g.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1));
  g.setIndex(idx);
  return { geometry: g, c, east, north };
}

const isVisibleInTree = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

/* ============================================================================
   7. ГЛАВНАЯ ФАБРИКА
   ============================================================================ */
export function createEarthGlobe(options = {}) {
  const opt = Object.assign({
    radius: 1,
    flattening: 0.1,
    geoidAmp: 1.0,
    sunDirection: [1.0, 0.35, 0.8],
    spin: 0,
  }, options);

  const group = new THREE.Group();
  group.name = 'EarthGlobe';
  group.scale.setScalar(opt.radius);

  const U = {
    uTime: { value: 0 },
    uMorph: { value: 0 },
    uFlat: { value: opt.flattening },
    uGeoAmp: { value: opt.geoidAmp },
    uBDir: { value: BUMPS.map((b) => b.dir.clone()) },
    uBAmp: { value: BUMPS.map((b) => b.amp) },
    uBS: { value: BUMPS.map((b) => b.s) },
    uSun: { value: new THREE.Vector3(...opt.sunDirection).normalize() },
    uScale: { value: 800 },
  };
  const mat = (vs, fs, uniforms = {}, o = {}) => new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, uniforms: Object.assign({}, U, uniforms), ...o,
  });
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  const sz = new THREE.Vector2();
  const hookScale = (obj) => {
    obj.frustumCulled = false;
    obj.onBeforeRender = function (renderer, scene, camera) {
      renderer.getDrawingBufferSize(sz);
      const f = camera.isPerspectiveCamera ? sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) : 800;
      U.uScale.value = f * this.matrixWorld.getMaxScaleOnAxis();
    };
  };

  const layers = {
    grid: new THREE.Group(), storms: new THREE.Group(), capeHorn: new THREE.Group(),
    currents: new THREE.Group(), markers: new THREE.Group(),
  };
  Object.entries(layers).forEach(([k, g]) => { g.name = 'layer:' + k; group.add(g); });

  const landTex = makeLandTexture();
  const planetMat = mat(PLANET_VS, PLANET_FS, { uLand: { value: landTex } });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), planetMat);
  planet.name = 'planet'; planet.frustumCulled = false; planet.renderOrder = 0;
  group.add(planet);

  const atmoMat = mat(ATMO_VS, ATMO_FS, {}, { side: THREE.BackSide, ...additive });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.12, 96, 64), atmoMat);
  atmo.renderOrder = 6; atmo.frustumCulled = false;
  group.add(atmo);

  const labels = [];
  const addLabel = (parent, text, lat, lon, alt, color) => {
    const s = makeLabelSprite(text, color);
    parent.add(s);
    labels.push({ s, lat, lon, alt });
  };

  {
    const positions = [], ts = [], dpos = [], dts = [];
    const seg = (outP, outT, fn, n) => {
      for (let i = 0; i < n; i++) {
        const a = fn(i / n), b = fn((i + 1) / n);
        outP.push(a.x, a.y, a.z, b.x, b.y, b.z);
        outT.push(i / n, (i + 1) / n);
      }
    };
    const parallel = (lat) => (t) => latLonToVector3(lat, -180 + 360 * t, 1);
    const meridian = (lon) => (t) => latLonToVector3(-90 + 180 * t, lon, 1);
    for (let lat = -75; lat <= 75; lat += 15) if (lat !== 0) seg(positions, ts, parallel(lat), 180);
    for (let lon = -180; lon < 180; lon += 15) if (lon !== 0) seg(positions, ts, meridian(lon), 90);
    for (const lat of [23.44, -23.44, 66.56, -66.56]) seg(dpos, dts, parallel(lat), 240);

    const mkLines = (p, t, color, alpha, dash) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
      const m = mat(LINE_VS, LINE_FS, {
        uColor: { value: new THREE.Color(...color) }, uAlpha: { value: alpha }, uDash: { value: dash },
        uPulse: { value: 0 }, uAlt: { value: 0.004 },
      }, additive);
      const l = new THREE.LineSegments(g, m);
      l.frustumCulled = false; l.renderOrder = 3;
      return l;
    };
    layers.grid.add(mkLines(positions, ts, [0.15, 0.55, 0.85], 0.42, 0));
    layers.grid.add(mkLines(dpos, dts, [0.45, 0.85, 1.0], 0.55, 60));

    const circle = (fn) => {
      const pts = [];
      for (let i = 0; i < 360; i++) pts.push(fn((i / 360) * Math.PI * 2).multiplyScalar(1.006));
      return new THREE.CatmullRomCurve3(pts, true);
    };
    const equator = circle((a) => new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)));
    const greenwich = circle((a) => new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    const tube = (curve, color) => {
      for (const [r, alpha, pulse] of [[0.0034, 0.95, 1], [0.011, 0.14, 0]]) {
        const m = mat(TUBE_VS, LINE_FS, {
          uColor: { value: new THREE.Color(...color) }, uAlpha: { value: alpha }, uDash: { value: 0 },
          uPulse: { value: pulse },
        }, additive);
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 480, r, 6, true), m);
        mesh.frustumCulled = false; mesh.renderOrder = 3;
        layers.grid.add(mesh);
      }
    };
    tube(equator, [1.0, 0.72, 0.18]);
    tube(greenwich, [1.0, 0.3, 0.75]);

    addLabel(layers.grid, 'Экватор 0°', 0, -35, 0.035, '#ffd98a');
    addLabel(layers.grid, 'Гринвич 0°', 38, 0, 0.035, '#ffb3e6');
    addLabel(layers.grid, 'Полярный круг 66°34′', 66.56, 75, 0.035, '#bfeaff');
  }

  {
    const th0 = THREE.MathUtils.degToRad(90 + 35), th1 = THREE.MathUtils.degToRad(90 + 66);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 256, 48, 0, Math.PI * 2, th0, th1 - th0),
      mat(STORM_VS, STORM_FS, { uAlt: { value: 0.012 } }, { transparent: true, depthWrite: false, side: THREE.DoubleSide })
    );
    shell.frustumCulled = false; shell.renderOrder = 2;
    layers.storms.add(shell);

    const STREAMS = 1100, TRAIL = 5, n = STREAMS * TRAIL;
    const aLat = new Float32Array(n), aLon = new Float32Array(n), aSpd = new Float32Array(n);
    const aTrail = new Float32Array(n), aSeed = new Float32Array(n), aTone = new Float32Array(n);
    for (let s = 0; s < STREAMS; s++) {
      const latD = -40 - Math.pow(Math.random(), 0.8) * 20;
      const lat = THREE.MathUtils.degToRad(latD), lon = Math.random() * Math.PI * 2;
      const spd = 0.09 + Math.random() * 0.12 + (latD < -50 ? 0.05 : 0), seed = Math.random();
      const tone = THREE.MathUtils.smoothstep(-latD, 47, 55);
      for (let k = 0; k < TRAIL; k++) {
        const i = s * TRAIL + k;
        aLat[i] = lat; aLon[i] = lon; aSpd[i] = spd; aTrail[i] = k / TRAIL; aSeed[i] = seed; aTone[i] = tone;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aLat', new THREE.BufferAttribute(aLat, 1));
    g.setAttribute('aLon', new THREE.BufferAttribute(aLon, 1));
    g.setAttribute('aSpd', new THREE.BufferAttribute(aSpd, 1));
    g.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    g.setAttribute('aTone', new THREE.BufferAttribute(aTone, 1));
    const pts = new THREE.Points(g, mat(STORMP_VS, SOFT_POINT_FS, {
      uAlt: { value: 0.016 },
      uColA: { value: new THREE.Color(0.35, 0.9, 1.0) }, uColB: { value: new THREE.Color(0.85, 0.75, 1.0) },
    }, additive));
    pts.renderOrder = 4; hookScale(pts);
    layers.storms.add(pts);

    addLabel(layers.storms, 'Ревущие сороковые', -45, 150, 0.04, '#aef0ff');
    addLabel(layers.storms, 'Неистовые пятидесятые', -55, 150, 0.04, '#d6c8ff');
  }

  const horn = MARKERS.find((m) => m.id === 'horn');
  {
    const angR = THREE.MathUtils.degToRad(9);
    const { geometry, c, east, north } = buildPatchGeometry(horn.lat, horn.lon, angR);
    const patch = new THREE.Mesh(geometry, mat(HORN_VS, HORN_FS, { uAlt: { value: 0.02 } }, additive));
    patch.frustumCulled = false; patch.renderOrder = 4;
    layers.capeHorn.add(patch);

    const N = 420, T = 4, n = N * T;
    const aRad = new Float32Array(n), aAng = new Float32Array(n), aSeed = new Float32Array(n), aTrail = new Float32Array(n);
    for (let i = 0; i < N; i++) {
      const r = Math.sqrt(Math.random()) * 0.95 + 0.03, a = Math.random() * Math.PI * 2, s = Math.random();
      for (let k = 0; k < T; k++) {
        const j = i * T + k;
        aRad[j] = r; aAng[j] = a; aSeed[j] = s; aTrail[j] = k / T;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aRad', new THREE.BufferAttribute(aRad, 1));
    g.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    g.setAttribute('aTrail', new THREE.BufferAttribute(aTrail, 1));
    const pts = new THREE.Points(g, mat(HORNP_VS, SOFT_POINT_FS, {
      uC: { value: c }, uE: { value: east }, uN: { value: north }, uAngR: { value: angR }, uAlt: { value: 0.024 },
      uColA: { value: new THREE.Color(1.0, 0.85, 0.5) }, uColB: { value: new THREE.Color(1.0, 0.3, 0.15) },
    }, additive));
    pts.renderOrder = 5; hookScale(pts);
    layers.capeHorn.add(pts);
  }

  for (const def of CURRENTS) {
    const ctrl = def.way.map(([la, lo]) => latLonToVector3(la, lo, 1));
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const path = [];
    for (let i = 0; i < 64; i++) path.push(curve.getPointAt(i / 63).normalize());
    const col = new THREE.Color(...def.color);

    const LN = 220, lp = [], lt = [];
    for (let i = 0; i < LN; i++) {
      const a = curve.getPointAt(i / LN).normalize(), b = curve.getPointAt((i + 1) / LN).normalize();
      lp.push(a.x, a.y, a.z, b.x, b.y, b.z); lt.push(i / LN, (i + 1) / LN);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('aT', new THREE.Float32BufferAttribute(lt, 1));
    const line = new THREE.LineSegments(lg, mat(LINE_VS, LINE_FS, {
      uColor: { value: col.clone() }, uAlpha: { value: 0.3 }, uDash: { value: 90 }, uPulse: { value: 0 }, uAlt: { value: 0.01 },
    }, additive));
    line.frustumCulled = false; line.renderOrder = 4;
    layers.currents.add(line);

    const n = def.count, aOff = new Float32Array(n), aSeed = new Float32Array(n), aSide = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      aOff[i] = (i + Math.random() * 0.6) / n;
      aSeed[i] = Math.random();
      aSide[i] = (Math.random() * 2 - 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(aOff, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
    const pts = new THREE.Points(g, mat(CURR_VS, CURR_FS, {
      uPath: { value: path }, uSpeed: { value: def.speed }, uSize: { value: 0.05 }, uAlt: { value: 0.014 },
      uWidth: { value: 0.022 }, uColor: { value: col },
    }, additive));
    pts.renderOrder = 5; hookScale(pts);
    layers.currents.add(pts);
  }
  addLabel(layers.currents, 'Гольфстрим', 38, -52, 0.04, '#ffc999');
  addLabel(layers.currents, 'Куросио', 30, 155, 0.04, '#ffb3d1');

  const glowTex = makeGlowTexture();
  const white = new THREE.Color(1, 1, 1);
  const markers = MARKERS.map((def, i) => {
    const col = new THREE.Color(def.color);
    const pivot = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 6), new THREE.MeshBasicMaterial({ color: col }));
    stem.position.y = 0.035;
    
    // Вшиваем пасхалку — если маркер Мурманск, генерируем форму 3D-сердца
    const isHeart = def.id === 'murmansk';
    const headGeo = isHeart ? createHeartGeometry() : new THREE.SphereGeometry(0.013, 16, 12);
    const headMat = new THREE.MeshBasicMaterial({ color: isHeart ? col : col.clone().lerp(white, 0.55) });
    
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.078;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.y = 0.078; halo.scale.setScalar(0.17);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.024, 40), new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.05;
    pivot.add(stem, head, halo, ring, hit);
    [stem, head, halo, ring].forEach((o) => { o.renderOrder = 7; });
    (layers[def.layer || 'markers']).add(pivot);
    const m = { def, pivot, head, halo, ring, hit, phase: i * 0.7, hover: 0, dir: latLonToVector3(def.lat, def.lon, 1) };
    hit.userData.marker = m;
    return m;
  });
  const hitMeshes = markers.map((m) => m.hit);

  const _d = new THREE.Vector3();
  const undulationJS = (d) => {
    let u = 0;
    for (const b of BUMPS) u += b.amp * Math.exp(-(1 - d.dot(b.dir)) / b.s);
    u += 0.012 * (Math.sin(2.3 * d.x + 1.1) * Math.cos(1.9 * d.z - 0.4) + Math.sin(3.1 * d.y + 0.7) * Math.cos(2.2 * d.x));
    return u;
  };
  const surfacePointJS = (d, out) => {
    const e = THREE.MathUtils.clamp(U.uMorph.value, 0, 1), g = THREE.MathUtils.clamp(U.uMorph.value - 1, 0, 1);
    const k = undulationJS(d) * U.uGeoAmp.value * g;
    return out.set(d.x * (1 + k), d.y * (THREE.MathUtils.lerp(1, 1 - U.uFlat.value, e) + k), d.z * (1 + k));
  };
  const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3();
  const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0);
  const surfaceNormalJS = (d, out) => {
    _t1.crossVectors(Math.abs(d.y) > 0.99 ? _x : _up, d).normalize();
    _t2.crossVectors(d, _t1);
    const e = 0.002;
    surfacePointJS(d, _p0);
    surfacePointJS(_tmp.copy(d).addScaledVector(_t1, e).normalize(), _p1);
    surfacePointJS(_tmp.copy(d).addScaledVector(_t2, e).normalize(), _p2);
    return out.crossVectors(_p1.sub(_p0), _p2.sub(_p0)).normalize();
  };

  const getSurfacePoint = (lat, lon, alt = 0, target = new THREE.Vector3()) => {
    latLonToVector3(lat, lon, 1, _d);
    surfacePointJS(_d, target);
    return target.addScaledVector(_d, alt);
  };

  const MORPH = { sphere: 0, ellipsoid: 1, geoid: 2 };
  let morphTarget = 0;
  const setMorph = (v) => { morphTarget = THREE.MathUtils.clamp(typeof v === 'string' ? (MORPH[v] ?? 0) : v, 0, 2); };
  const setMorphImmediate = (v) => { setMorph(v); U.uMorph.value = morphTarget; };

  const setLayer = (name, on) => { if (layers[name]) layers[name].visible = !!on; return !!on; };
  const toggleLayer = (name) => setLayer(name, !layers[name].visible);

  let tip = null, camRef = null, domRef = null, hovered = null, pinned = null;
  const unbinders = [];
  const _wp = new THREE.Vector3(), _wn = new THREE.Vector3(), _cp = new THREE.Vector3();

  function bindPointer(camera, dom) {
    camRef = camera; domRef = dom;
    const host = dom.parentElement || document.body;
    tip = document.createElement('div');
    tip.style.cssText = 'position:absolute;left:0;top:0;z-index:15;pointer-events:none;opacity:0;max-width:260px;'
      + 'padding:12px 14px;border-radius:14px;color:#eaf3fb;font:13px/1.4 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;'
      + 'background:linear-gradient(145deg,rgba(255,255,255,.14),rgba(255,255,255,.03)),rgba(14,27,46,.85);'
      + 'border:1px solid rgba(255,255,255,.2);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);'
      + 'box-shadow:0 10px 30px rgba(0,0,0,.4);transition:opacity .2s ease;will-change:transform;';
    host.appendChild(tip);

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (e) => {
      const r = dom.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const h of ray.intersectObjects(hitMeshes, false)) {
        const m = h.object.userData.marker;
        if (!isVisibleInTree(m.pivot)) continue;
        m.pivot.getWorldPosition(_wp);
        _wn.set(0, 1, 0).transformDirection(m.pivot.matrixWorld);
        if (_wn.dot(_cp.copy(camera.position).sub(_wp)) > 0) return m;
      }
      return null;
    };
    const show = (m) => {
      tip.innerHTML = `<b style="font-size:15px;display:block;margin-bottom:4px;">${m.def.title}</b>`
        + `<div style="color:#7fe3ff;font-size:11.5px;margin-bottom:8px;font-family:monospace;">${m.def.coords}</div>`
        + `<div style="color:#c9d9e8;font-size:13px">${m.def.note}</div>`;
    };
    let prevCursor = '', down = null;
    const onMove = (e) => {
      if (e.pointerType !== 'mouse') return;
      const m = pick(e);
      if (m !== hovered) {
        hovered = m;
        if (m) { prevCursor = dom.style.cursor; dom.style.cursor = 'pointer'; show(m); }
        else dom.style.cursor = prevCursor;
      }
    };
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8 || e.pointerType === 'mouse') return;
      const m = pick(e);
      pinned = m && m !== pinned ? m : null;
      if (pinned) show(pinned);
    };
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    unbinders.push(() => {
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      tip.remove(); tip = null; hovered = pinned = null;
    });
    return () => unbinders.pop()();
  }

  function updateTooltip() {
    if (!tip || !camRef) return;
    const m = hovered || pinned;
    if (!m || !isVisibleInTree(m.pivot)) { tip.style.opacity = '0'; return; }
    m.head.getWorldPosition(_wp);
    _wn.set(0, 1, 0).transformDirection(m.pivot.matrixWorld);
    if (_wn.dot(_cp.copy(camRef.position).sub(_wp)) <= 0) { tip.style.opacity = '0'; return; }
    _wp.project(camRef);
    const r = domRef.getBoundingClientRect(), pr = (tip.parentElement || document.body).getBoundingClientRect();
    const x = r.left - pr.left + (_wp.x * 0.5 + 0.5) * r.width;
    const y = r.top - pr.top + (-_wp.y * 0.5 + 0.5) * r.height;
    tip.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) translate(-50%,calc(-100% - 22px))`;
    tip.style.opacity = '1';
  }

  let lastT = null;
  function update(time) {
    const dt = lastT === null ? 0 : THREE.MathUtils.clamp(time - lastT, 0, 0.1);
    lastT = time;
    U.uTime.value = time;
    if (opt.spin) group.rotation.y += opt.spin * dt;

    const cur = U.uMorph.value;
    if (Math.abs(morphTarget - cur) > 0.0005) U.uMorph.value = cur + (morphTarget - cur) * (1 - Math.exp(-dt * 2.6));
    else U.uMorph.value = morphTarget;

    const q = new THREE.Quaternion();
    for (const m of markers) {
      surfacePointJS(m.dir, _d);
      m.pivot.position.copy(_d);
      surfaceNormalJS(m.dir, _n);
      m.pivot.quaternion.copy(q.setFromUnitVectors(_up, _n));
      const hv = hovered === m || pinned === m ? 1 : 0;
      m.hover += (hv - m.hover) * Math.min(1, dt * 10);
      m.pivot.scale.setScalar(1 + 0.3 * m.hover);
      const ph = (time * 0.55 + m.phase) % 1;
      m.ring.scale.setScalar(1 + ph * 3.2);
      m.ring.material.opacity = 0.85 * (1 - ph);
      m.halo.scale.setScalar(0.17 * (1 + 0.16 * Math.sin(time * 3.1 + m.phase)));
      
      // Анимация пасхалки
      if (m.def.id === 'murmansk') {
        m.head.rotation.y = time * 1.5; // плавное вращение сердечка
        const beat = 1 + 0.2 * Math.sin(time * 8.0); // сильное сердцебиение
        m.head.scale.setScalar(beat);
      }
    }
    for (const l of labels) l.s.position.copy(getSurfacePoint(l.lat, l.lon, l.alt, _tmp));
    updateTooltip();
  }

  function dispose() {
    while (unbinders.length) unbinders.pop()();
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
    landTex.dispose(); glowTex.dispose();
    group.removeFromParent();
  }

  update(0);
  U.uMorph.value = morphTarget;

  const api = {
    group, update, dispose, latLonToVector3, getSurfacePoint, bindPointer,
    setMorph, setMorphImmediate, get morph() { return U.uMorph.value; },
    setLayer, toggleLayer, layers,
    setSunDirection: (x, y, z) => U.uSun.value.set(x, y, z).normalize(),
    setFlattening: (v) => { U.uFlat.value = v; },
    setGeoidAmplitude: (v) => { U.uGeoAmp.value = v; },
    markers,
  };
  group.userData.earth = api;
  group.update = update;
  return api;
}
