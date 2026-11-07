// Estadio de noche "de Champions" a tamaño real, alrededor del jugador (VR completa y escritorio).
// Low poly, pero con la luz de cine: cuenco ovalado de dos anillos, anillo de focos con halo,
// haces de luz entre la niebla, público como un mar de puntos con flashes y césped a franjas.
import * as THREE from 'three';

const A = 45, B = 62; // semiejes del óvalo a pie de grada (x, z)

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  return t;
}

// Público: un mar de puntitos de colores sobre filas oscuras
function crowdTexture() {
  return canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#10151d'; g.fillRect(0, 0, w, h);
    const cols = ['#2a5fd6', '#2a5fd6', '#c8202e', '#c8202e', '#e9edf2', '#f1c27d', '#c68642', '#1d1d1d', '#ffd34d'];
    for (let row = 0; row < h; row += 6) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, row + 5, w, 1);
      for (let x = 0; x < w; x += 3) {
        if (Math.random() < 0.12) continue;
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = 0.55 + Math.random() * 0.45;
        g.fillRect(x + Math.random(), row + Math.random() * 1.5, 2, 3);
      }
    }
    g.globalAlpha = 1;
  }, true);
}

function pitchTexture() {
  return canvasTex(1024, 1600, (g, w, h) => {
    for (let i = 0; i < 20; i++) { g.fillStyle = i % 2 ? '#1f5e29' : '#1a5223'; g.fillRect(0, (i * h) / 20, w, h / 20 + 1); }
    // charcos de luz de los focos y centro más iluminado
    g.globalCompositeOperation = 'lighter';
    const pool = (x, y, r, a) => { const q = g.createRadialGradient(x, y, 0, x, y, r); q.addColorStop(0, `rgba(170,220,150,${a})`); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
    pool(w / 2, h / 2, h * 0.45, 0.22);
    for (let i = 0; i < 14; i++) pool(Math.random() * w, Math.random() * h, 120 + Math.random() * 160, 0.12);
    g.globalCompositeOperation = 'source-over';
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5;
    const m = 40, W = w - 2 * m, H = h - 2 * m;
    g.strokeRect(m, m, W, H);
    g.beginPath(); g.moveTo(m, h / 2); g.lineTo(w - m, h / 2); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, (9.15 / 68) * W, 0, Math.PI * 2); g.stroke();
    for (const top of [true, false]) {
      const y0 = top ? m : h - m, d = top ? 1 : -1;
      const bw = (40.3 / 68) * W, bh = (16.5 / 105) * H, sw = (18.3 / 68) * W, sh = (5.5 / 105) * H;
      g.strokeRect(w / 2 - bw / 2, top ? y0 : y0 - bh, bw, bh);
      g.strokeRect(w / 2 - sw / 2, top ? y0 : y0 - sh, sw, sh);
    }
  });
}

function ledTexture() {
  return canvasTex(2048, 64, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0b2a6b'); grd.addColorStop(1, '#06143a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.font = '900 40px system-ui, sans-serif'; g.textBaseline = 'middle';
    let x = 10;
    const items = ['★ CAMPIONI ★', 'GARBANZO FC', 'CHAPAS DE ORO', 'TAPÓN & CELO', '★ CAMPIONI ★', '¡FORZA!'];
    while (x < w) for (const t of items) { g.fillStyle = '#ffffff'; g.fillText(t, x, 34); x += g.measureText(t).width + 70; }
  }, true);
}

// Anillo de malla siguiendo el óvalo: profile = [[d (hacia fuera), y], ...]
function ovalRing(profile, segs, uRepeat) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    let nx = c / A, nz = s / B;
    const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    profile.forEach(([d, y], j) => {
      pos.push(A * c + nx * d, y, B * s + nz * d);
      uv.push((i / segs) * uRepeat, j / (profile.length - 1));
    });
  }
  const n = profile.length;
  for (let i = 0; i < segs; i++) for (let j = 0; j < n - 1; j++) {
    const a = i * n + j, b = (i + 1) * n + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
function ovalPoint(th, d, y, out = new THREE.Vector3()) {
  const c = Math.cos(th), s = Math.sin(th);
  let nx = c / A, nz = s / B;
  const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
  return out.set(A * c + nx * d, y, B * s + nz * d);
}

const SKY = {
  night: { top: [0.01, 0.02, 0.06], horizon: [0.10, 0.16, 0.30], cloud: [0.20, 0.26, 0.38], fog: 0x1a2740, lamp: [0.85, 0.92, 1.0], sun: 0xe6efff },
  sunset: { top: [0.05, 0.10, 0.22], horizon: [0.95, 0.45, 0.18], cloud: [1.0, 0.62, 0.35], fog: 0x4a3a3a, lamp: [1.0, 0.86, 0.6], sun: 0xffd9a8 },
};

export function buildArena() {
  const g = new THREE.Group();
  const uniforms = { uTime: { value: 0 }, uBoost: { value: 0 }, uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uCloud: { value: new THREE.Color() }, uSunset: { value: 0 }, uLamp: { value: new THREE.Color() } };

  // ---- cielo con nubes ----
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 uTop, uHorizon, uCloud; uniform float uTime, uSunset;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        float y = max(vP.y, 0.0);
        vec3 col = mix(uHorizon, uTop, pow(y, 0.55));
        vec2 q = vP.xz / (vP.y + 0.35) * 2.0 + vec2(uTime * 0.01, 0.0);
        float c = smoothstep(0.45, 0.85, fbm(q));
        col = mix(col, uCloud, c * smoothstep(0.02, 0.25, y) * 0.7);
        float st = step(0.9975, h(floor(vP.xz * 260.0 + vP.y * 91.0))) * (1.0 - uSunset) * smoothstep(0.15, 0.5, y) * (1.0 - c);
        gl_FragColor = vec4(col + st, 1.0);
      }`,
  }));
  g.add(sky);

  // ---- césped y alrededores ----
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(76, 115), new THREE.MeshBasicMaterial({ map: pitchTexture(), color: 0x9aa59a }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = false;
  g.add(pitch);
  const apron = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x123a19 }));
  apron.scale.set(A + 2, B + 2, 1);
  apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02;
  g.add(apron);
  // porterías reales
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const z = s * 52.5;
    for (const x of [-3.66, 3.66]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), white); p.position.set(x, 1.22, z); g.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, z); g.add(bar);
    const net = new THREE.Mesh(new THREE.BoxGeometry(7.32, 2.44, 2, 10, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }));
    net.position.set(0, 1.22, z + s * 1); g.add(net);
  }

  // ---- vallas LED alrededor del césped ----
  const led = ledTexture();
  led.repeat.set(3, 1);
  const ledMat = new THREE.MeshBasicMaterial({ map: led });
  for (const [w, x, z, ry] of [[100, -38, 0, Math.PI / 2], [100, 38, 0, -Math.PI / 2], [70, 0, -56, 0], [70, 0, 56, Math.PI]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.9), ledMat);
    m.position.set(x, 0.45, z); m.rotation.y = ry;
    g.add(m);
  }

  // ---- gradas: cuenco ovalado de dos anillos ----
  const crowd = crowdTexture();
  const crowdMat = new THREE.MeshBasicMaterial({ map: crowd, color: 0x8a95a8, side: THREE.DoubleSide });
  const crowdMatHi = new THREE.MeshBasicMaterial({ map: crowd, color: 0x6a7488, side: THREE.DoubleSide });
  const SEG = 96;
  const lower = new THREE.Mesh(ovalRing([[0, 1.2], [20, 13]], SEG, 30), crowdMat);
  const upper = new THREE.Mesh(ovalRing([[22, 16], [41, 35]], SEG, 30), crowdMatHi);
  g.add(lower, upper);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 1, side: THREE.DoubleSide, flatShading: true });
  g.add(new THREE.Mesh(ovalRing([[0, 0], [0, 1.2]], SEG, 1), concrete)); // muro a pie de grada
  g.add(new THREE.Mesh(ovalRing([[20, 13], [22, 13], [22, 16]], SEG, 1), concrete)); // pasillo entre anillos
  g.add(new THREE.Mesh(ovalRing([[41, 35], [42, 42]], SEG, 1), concrete)); // pared trasera
  // anillo de luz entre las dos gradas (como en los estadios de verdad)
  const ringLight = new THREE.Mesh(ovalRing([[21.9, 14.3], [21.9, 15.2]], SEG, 1), new THREE.MeshBasicMaterial({ color: 0xbfd6ff, side: THREE.DoubleSide }));
  g.add(ringLight);

  // ---- techo en voladizo con su estructura ----
  const roofTex = canvasTex(512, 64, (c, w, h) => {
    c.fillStyle = '#161c25'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2c3644'; c.lineWidth = 3;
    for (let x = 0; x < w; x += 32) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 32, h); c.moveTo(x + 32, 0); c.lineTo(x, h); c.stroke(); }
  }, true);
  const roof = new THREE.Mesh(ovalRing([[42, 42], [10, 44.5]], SEG, 40), new THREE.MeshStandardMaterial({ map: roofTex, roughness: 1, side: THREE.DoubleSide }));
  g.add(roof);

  // ---- anillo de focos con halo (una sola llamada de dibujo) ----
  const lampPos = [];
  for (let i = 0; i < 180; i++) {
    const th = (i / 180) * Math.PI * 2;
    lampPos.push(...ovalPoint(th, 10.5, 44.0).toArray());
    if (i % 2 === 0) lampPos.push(...ovalPoint(th + 0.017, 12.5, 44.3).toArray());
  }
  // focos sueltos en la pasarela
  for (let i = 0; i < 48; i++) lampPos.push(...ovalPoint((i / 48) * Math.PI * 2, 21.9, 15.6).toArray());
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: `uniform float uBoost; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (2600.0 + uBoost * 900.0) / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uLamp; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float core = smoothstep(0.3, 0.0, d); float halo = pow(max(0.0, 1.0 - d), 2.2) * 0.75; gl_FragColor = vec4(uLamp * (core + halo), core + halo); }`,
  }));
  lamps.frustumCulled = false;
  g.add(lamps);

  // ---- resplandores grandes del anillo de focos ----
  const glowTex = canvasTex(128, 128, (c, w) => {
    const q = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    q.addColorStop(0, 'rgba(255,255,255,0.9)'); q.addColorStop(0.25, 'rgba(255,255,255,0.35)'); q.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = q; c.fillRect(0, 0, w, w);
  });
  const glows = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
    sp.position.copy(ovalPoint((i / 16) * Math.PI * 2 + 0.1, 11, 43.5));
    sp.scale.set(26, 26, 1);
    g.add(sp);
    glows.push(sp);
  }

  // ---- haces de luz hacia el césped ----
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms,
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying float vY; uniform vec3 uLamp; uniform float uBoost; void main(){ float a = (0.15 + 0.85 * pow(vY, 1.5)) * (0.05 + uBoost * 0.04); gl_FragColor = vec4(uLamp, a); }',
  });
  const beams = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 20; i++) {
    const th = (i / 20) * Math.PI * 2 + 0.08;
    const from = ovalPoint(th, 10.5, 44.0);
    const to = new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 80);
    const len = from.distanceTo(to);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(8, len, 16, 1, true), beamMat);
    // vértice del cono en el foco, base en el césped
    cone.position.copy(from).add(to).multiplyScalar(0.5);
    cone.quaternion.setFromUnitVectors(up, from.clone().sub(to).normalize());
    beams.add(cone);
  }
  g.add(beams);

  // ---- flashes de cámaras en la grada ----
  const fl = [], seeds = [];
  for (let i = 0; i < 2200; i++) {
    const th = Math.random() * Math.PI * 2;
    const t = Math.random();
    const upperTier = Math.random() < 0.55;
    const d = upperTier ? 22 + t * 19 : t * 20, y = upperTier ? 16 + t * 19 : 1.2 + t * 11.8;
    fl.push(...ovalPoint(th, d, y + 0.3).toArray());
    seeds.push(Math.random());
  }
  const flGeo = new THREE.BufferGeometry();
  flGeo.setAttribute('position', new THREE.Float32BufferAttribute(fl, 3));
  flGeo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
  const flashes = new THREE.Points(flGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms,
    vertexShader: `attribute float seed; uniform float uTime, uBoost; varying float vA;
      void main(){
        float rate = 0.35 + seed * 0.6 + uBoost * 3.0;
        float ph = fract(uTime * rate * 0.25 + seed * 17.0);
        vA = smoothstep(0.985 - uBoost * 0.08, 1.0, ph);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = 700.0 / -mv.z * vA;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA; gl_FragColor = vec4(vec3(1.0), a); }',
  }));
  flashes.frustumCulled = false;
  g.add(flashes);

  // ---- control ----
  let cheer = 0;
  let fogColor = new THREE.Color();
  function setSky(mode) {
    const s = SKY[mode] || SKY.night;
    uniforms.uTop.value.setRGB(...s.top);
    uniforms.uHorizon.value.setRGB(...s.horizon);
    uniforms.uCloud.value.setRGB(...s.cloud);
    uniforms.uLamp.value.setRGB(...s.lamp);
    uniforms.uSunset.value = mode === 'sunset' ? 1 : 0;
    for (const sp of glows) sp.material.color.setRGB(...s.lamp);
    fogColor = new THREE.Color(s.fog);
    return s;
  }
  setSky('night');
  return {
    group: g,
    setSky,
    get fogColor() { return fogColor; },
    cheer() { cheer = 3.5; },
    update(dt, t) {
      cheer = Math.max(0, cheer - dt);
      const k = Math.min(1, cheer / 1.5);
      uniforms.uTime.value = t;
      uniforms.uBoost.value = k;
      // con el gol, la grada "salta": el público tiembla y brilla más
      crowd.offset.y = k > 0 ? Math.sin(t * 18) * 0.004 * k : 0;
      crowdMat.color.setScalar(0.55 + k * 0.3); crowdMatHi.color.setScalar(0.45 + k * 0.3);
      led.offset.x = (t * 0.02) % 1;
      for (const sp of glows) sp.material.opacity = 0.55 + k * 0.35 * (0.5 + 0.5 * Math.sin(t * 20 + sp.position.x));
    },
  };
}
