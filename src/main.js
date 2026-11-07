import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { World, setupMatch, shoot, MAX_SHOT, FIELD } from './physics.js';
import { think } from './ai.js';
import { buildTable, buildCap, buildBall, buildShadow, textPanel, makeButton, TEAMS } from './visuals.js';
import { buildStadium } from './stadium.js';
import { initAudio, hitSound, flickSound, goalSound, buttonSound } from './audio.js';

// ---------- Ajustes de juego ----------
const GOALS_TO_WIN = 3;
const FLICK_MIN = 0.3; // m/s de la punta del dedo para que cuente como "toque"
const FLICK_GAIN = 1.3; // velocidad de la chapa = velocidad del dedo × esto
const SLING_GAIN = 11; // tirachinas: m/s por metro de estirón
const PINCH_ON = 0.018, PINCH_OFF = 0.035;

// ---------- Escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bgColor = new THREE.Color(0x1b2430);
scene.background = bgColor;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 1.22, 0.78);
camera.lookAt(0, 0.8, -0.12);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 2, 0.8);
scene.add(sun);

// Habitación sencilla para modo VR / escritorio (en realidad mixta se oculta y ves tu casa)
const room = new THREE.Group();
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 1, flatShading: true }));
floor.rotation.x = -Math.PI / 2;
room.add(floor);
scene.add(room);

// Todo lo de la mesa cuelga de "root": se puede recolocar y subir/bajar
const root = new THREE.Group();
root.position.set(0, 0.8, 0);
scene.add(root);
const table = buildTable();
root.add(table);
const cushions = table.userData.cushions;
const stadium = buildStadium();
root.add(stadium.group);
function flashCushion(x, z, speed) {
  let best = null, bd = Infinity;
  for (const c of cushions) {
    const ex = c.x2 - c.x1, ez = c.z2 - c.z1;
    let t = ((x - c.x1) * ex + (z - c.z1) * ez) / (ex * ex + ez * ez);
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (c.x1 + ex * t), z - (c.z1 + ez * t));
    if (d < bd) { bd = d; best = c; }
  }
  if (best && bd < 0.03) best.flash = Math.max(best.flash, Math.min(1, speed * 0.8));
}
function updateCushions(dt) {
  for (const c of cushions) {
    if (c.flash <= 0) continue;
    c.flash = Math.max(0, c.flash - dt * 3);
    c.mesh.material.emissiveIntensity = c.flash * 1.4;
    c.mesh.scale.y = 1 + c.flash * 0.35; // la goma "se hincha" un poco
  }
}

// mesa física (solo en VR/escritorio)
const tableLegs = new THREE.Group();
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.9, flatShading: true });
  const top = new THREE.Mesh(new THREE.BoxGeometry(FIELD.W + 0.3, 0.03, FIELD.L + 0.35), wood);
  top.position.y = -0.034;
  tableLegs.add(top);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05), wood);
    leg.position.set(x * (FIELD.W / 2 + 0.1), -0.45, z * (FIELD.L / 2 + 0.12));
    tableLegs.add(leg);
  }
}
root.add(tableLegs);

// ---------- Mundo ----------
const world = new World();
let meshes = [], shadows = [];
const bodyLayer = new THREE.Group();
root.add(bodyLayer);

function rebuildBodies() {
  bodyLayer.clear();
  meshes = []; shadows = [];
  for (const b of world.bodies) {
    const s = buildShadow(b.r);
    bodyLayer.add(s);
    shadows.push(s);
    const m = b.kind === 'ball' ? buildBall(b) : buildCap(b);
    bodyLayer.add(m);
    meshes.push(m);
  }
  syncMeshes(0);
}

const tmpAxis = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function syncMeshes(dt) {
  world.bodies.forEach((b, i) => {
    const m = meshes[i];
    m.position.set(b.x, 0, b.z);
    shadows[i].position.set(b.x + 0.002, 0.0004, b.z + 0.002);
    if (b.kind === 'ball') {
      const s = Math.hypot(b.vx, b.vz);
      if (s > 0 && dt > 0) {
        tmpAxis.set(b.vz, 0, -b.vx).normalize();
        tmpQ.setFromAxisAngle(tmpAxis, (s * dt) / b.r);
        m.userData.ball.quaternion.premultiply(tmpQ);
      }
    } else {
      m.rotation.y = -b.angle;
    }
  });
}

// ---------- Marcador y botones ----------
const board = textPanel(0.36, 0.11);
board.position.set(0, 0.17, -FIELD.L / 2 - 0.06);
root.add(board);
let score = [0, 0];
let message = '';
function drawBoard() {
  board.userData.draw((g, w, h) => {
    g.fillStyle = 'rgba(10,16,24,0.85)';
    g.beginPath(); g.roundRect(0, 0, w, h, 40); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${Math.round(h * 0.16)}px system-ui, sans-serif`;
    g.fillStyle = '#6ea2ff'; g.fillText(TEAMS[0].name, w * 0.18, h * 0.32);
    g.fillStyle = '#ff6b7d'; g.fillText(TEAMS[1].name, w * 0.82, h * 0.32);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.round(h * 0.38)}px system-ui, sans-serif`;
    g.fillText(`${score[0]}  –  ${score[1]}`, w / 2, h * 0.3);
    g.font = `${Math.round(h * 0.17)}px system-ui, sans-serif`;
    g.fillStyle = '#ffe9a8';
    g.fillText(message, w / 2, h * 0.75);
  });
}
function say(m) { if (m !== message) { message = m; drawBoard(); } }

const buttons = [];
function addButton(label, x, y, z, onPress, opts = {}) {
  const b = makeButton(label, opts.w, opts.h, opts.color);
  b.position.set(x, y, z);
  b.rotation.x = opts.tilt ?? -0.5;
  b.userData.onPress = onPress;
  root.add(b);
  buttons.push(b);
  return b;
}
const nearZ = FIELD.L / 2 + 0.07;
addButton('▲', FIELD.W / 2 - 0.02, 0.03, nearZ, () => (root.position.y += 0.02), { w: 0.04, color: '#444c58' });
addButton('▼', FIELD.W / 2 - 0.07, 0.03, nearZ, () => (root.position.y -= 0.02), { w: 0.04, color: '#444c58' });
addButton('AQUÍ', FIELD.W / 2 - 0.13, 0.03, nearZ, () => (placeRequested = true), { w: 0.06, color: '#444c58' });
const playBtn = addButton('JUGAR', 0, 0.09, 0.05, () => startMatch(), { w: 0.14, h: 0.05, color: '#1f8a3e', tilt: -0.2 });

// ---------- Flecha de puntería (tirachinas) ----------
const aim = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.001, 1), mat);
  shaft.position.z = -0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.016, 12), mat);
  head.rotation.x = -Math.PI / 2;
  aim.add(shaft, head);
  aim.userData = { shaft, head };
}
aim.visible = false;
aim.position.y = 0.004;
root.add(aim);
function showAim(b, vx, vz) {
  const s = Math.hypot(vx, vz);
  if (s < 1e-3) { aim.visible = false; return; }
  const len = 0.03 + (s / MAX_SHOT) * 0.18;
  aim.visible = true;
  aim.position.set(b.x, 0.004, b.z);
  aim.rotation.y = Math.atan2(-vx, -vz);
  aim.userData.shaft.scale.z = len;
  aim.userData.shaft.position.z = -len / 2;
  aim.userData.head.position.z = -len;
  const hot = s / MAX_SHOT;
  aim.userData.shaft.material.color.setHSL(0.15 - hot * 0.15, 1, 0.6);
}

// ---------- Confeti ----------
const confetti = (() => {
  const N = 160;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.006, vertexColors: true }));
  pts.visible = false;
  root.add(pts);
  const vel = new Float32Array(N * 3);
  let t = 0;
  return {
    burst(z, team) {
      const c = new THREE.Color(TEAMS[team].shirt), w = new THREE.Color(0xffffff);
      for (let i = 0; i < N; i++) {
        pos.set([(Math.random() - 0.5) * 0.1, 0.02, z], i * 3);
        vel.set([(Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6], i * 3);
        const cc = Math.random() < 0.5 ? c : w;
        col.set([cc.r, cc.g, cc.b], i * 3);
      }
      geo.attributes.color.needsUpdate = true;
      t = 2; pts.visible = true;
    },
    update(dt) {
      if (t <= 0) return;
      t -= dt;
      for (let i = 0; i < N; i++) {
        vel[i * 3 + 1] -= 2.5 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0) { pos[i * 3 + 1] = 0; vel[i * 3] *= 0.5; vel[i * 3 + 2] *= 0.5; vel[i * 3 + 1] = 0; }
      }
      geo.attributes.position.needsUpdate = true;
      if (t <= 0) pts.visible = false;
    },
  };
})();

// ---------- Estado del partido ----------
// menu | aim | cpu | moving | goal | end
let state = 'menu';
let turn = 0;
let timer = 0;
let cpuGen = null, cpuShot = null;
let lastShooter = 0;

function startMatch() {
  score = [0, 0];
  setupMatch(world, 0);
  rebuildBodies();
  playBtn.visible = false;
  if (!renderer.xr.isPresenting) ui.style.display = 'none';
  giveTurn(0);
}

function giveTurn(team) {
  turn = team;
  if (team === 0) { state = 'aim'; say('Tu turno: dale con el dedo a una chapa azul'); }
  else { state = 'cpu'; timer = 0.8; cpuGen = null; cpuShot = null; say('Piensa el rival…'); }
}

function fire(b, vx, vz) {
  shoot(b, vx, vz);
  flickSound();
  aim.visible = false;
  world.ballTouched = false;
  lastShooter = b.team;
  state = 'moving';
  timer = 0;
  say('');
}

function updateGame(dt) {
  if (state === 'moving') {
    timer += dt;
    const ev = world.step(dt);
    for (const e of ev) {
      if (e.type === 'hit') hitSound(e.speed, e.a.kind === 'ball' || e.b.kind === 'ball' ? 'ball' : 'cap');
      else if (e.type === 'wall') { hitSound(e.speed, 'wall'); flashCushion(e.x, e.z, e.speed); }
      else if (e.type === 'net') hitSound(e.speed * 0.4, 'net');
    }
    if (world.goal) {
      const s = world.goal.scorer;
      score[s]++;
      goalSound();
      stadium.cheer(s);
      confetti.burst(s === 0 ? -FIELD.L / 2 : FIELD.L / 2, s);
      say(s === 0 ? '¡GOOOOL!' : 'Gol del rival…');
      state = 'goal';
      timer = 2.5;
      drawBoard();
    } else if (world.settled() || timer > 10) {
      world.stopAll();
      giveTurn(1 - lastShooter);
    }
  } else if (state === 'goal') {
    timer -= dt;
    if (timer <= 0) {
      if (score[0] >= GOALS_TO_WIN || score[1] >= GOALS_TO_WIN) {
        state = 'end';
        say(score[0] > score[1] ? '¡Campioni! Has ganado' : 'Ha ganado el rival');
        playBtn.visible = true;
      } else {
        const conceded = 1 - world.goal.scorer;
        setupMatch(world, conceded);
        rebuildBodies();
        giveTurn(conceded);
      }
    }
  } else if (state === 'cpu') {
    if (timer > 0) { timer -= dt; return; }
    if (!cpuGen) cpuGen = think(world, 1, { noise: 0.07 });
    if (!cpuShot) {
      const t0 = performance.now();
      while (performance.now() - t0 < 5) {
        const r = cpuGen.next();
        if (r.done) { cpuShot = r.value || { body: world.bodies.findIndex((b) => b.team === 1), vx: 0, vz: 0.5 }; timer = 0.6; break; }
      }
      return;
    }
    // resalta la chapa elegida un momento y dispara
    const b = world.bodies[cpuShot.body];
    showAim(b, cpuShot.vx, cpuShot.vz);
    timer -= dt;
    if (timer <= 0) fire(b, cpuShot.vx, cpuShot.vz);
  }
}

// ---------- Entrada: manos (XR) ----------
const handFactory = new XRHandModelFactory();
const hands = [0, 1].map((i) => {
  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, 'mesh'));
  scene.add(hand);
  const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  tipBall.visible = false;
  scene.add(tipBall);
  return { hand, tipBall, hist: { 'index-finger-tip': [], 'middle-finger-tip': [] }, pinching: false, sling: null, cooldown: 0 };
});
// Mandos (opcional): la empuñadura hace de dedo y el gatillo de pellizco
const pads = [0, 1].map((i) => {
  const grip = renderer.xr.getControllerGrip(i);
  const ctrl = renderer.xr.getController(i);
  scene.add(grip, ctrl);
  const p = { grip, ctrl, isHand: false, connected: false, hist: [], pressing: false, sling: null };
  ctrl.addEventListener('connected', (e) => { p.connected = true; p.isHand = !!e.data.hand; });
  ctrl.addEventListener('disconnected', () => { p.connected = false; });
  ctrl.addEventListener('selectstart', () => { p.pressing = true; });
  ctrl.addEventListener('selectend', () => { p.pressing = false; });
  return p;
});

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
function jointLocal(hand, name, out) {
  const j = hand.joints && hand.joints[name];
  if (!j || !j.visible) return null;
  j.getWorldPosition(out);
  return root.worldToLocal(out);
}

function pushHist(hist, now, p) {
  hist.push({ t: now, x: p.x, y: p.y, z: p.z });
  while (hist.length && now - hist[0].t > 120) hist.shift();
}
function velOf(hist, now) {
  // velocidad comparando con la muestra de hace ~50 ms (suaviza el temblor)
  if (hist.length < 2) return null;
  const cur = hist[hist.length - 1];
  let old = hist[0];
  for (const h of hist) if (now - h.t >= 45) old = h;
  const dt = (cur.t - old.t) / 1000;
  if (dt < 0.012) return null;
  return { vx: (cur.x - old.x) / dt, vz: (cur.z - old.z) / dt, old };
}

function myCapNear(x, z, maxD) {
  let best = null, bd = maxD;
  for (const b of world.bodies) {
    if (b.team !== 0) continue;
    const d = Math.hypot(b.x - x, b.z - z) - b.r;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function tryFlick(p, vel, capH = 0.03) {
  if (!vel || p.y > capH || p.y < -0.02) return false;
  const s = Math.hypot(vel.vx, vel.vz);
  if (s < FLICK_MIN) return false;
  const b = myCapNear(p.x, p.z, 0.012);
  if (!b) return false;
  // el dedo tiene que venir hacia la chapa, no alejarse
  const dNow = Math.hypot(b.x - p.x, b.z - p.z), dOld = Math.hypot(b.x - vel.old.x, b.z - vel.old.z);
  if (dOld <= dNow) return false;
  const k = Math.min(MAX_SHOT, s * FLICK_GAIN) / s;
  fire(b, vel.vx * k, vel.vz * k);
  return true;
}

function slingUpdate(holder, pinchOn, p) {
  // pellizcar cerca de una chapa, estirar hacia atrás y soltar
  if (!holder.sling && pinchOn && p && p.y < 0.07) {
    const b = myCapNear(p.x, p.z, 0.025);
    if (b) holder.sling = { b };
  }
  if (holder.sling) {
    const b = holder.sling.b;
    if (p) {
      holder.sling.vx = (b.x - p.x) * SLING_GAIN;
      holder.sling.vz = (b.z - p.z) * SLING_GAIN;
      holder.sling.pull = Math.hypot(b.x - p.x, b.z - p.z);
      showAim(b, holder.sling.vx, holder.sling.vz);
    }
    if (!pinchOn) {
      const s = holder.sling;
      holder.sling = null;
      aim.visible = false;
      if (s.pull > 0.012 && state === 'aim') fire(s.b, s.vx, s.vz);
    }
  }
}

function pokeButtons(p, now) {
  // p en coordenadas de root
  for (const btn of buttons) {
    if (!btn.visible) continue;
    v3.copy(p);
    root.localToWorld(v3);
    btn.worldToLocal(v3);
    const { w, h } = btn.userData;
    if (Math.abs(v3.x) < w / 2 && Math.abs(v3.y) < h / 2 && v3.z < 0.012 && v3.z > -0.02) {
      if (now - btn.userData.pressed > 600) {
        btn.userData.pressed = now;
        initAudio();
        buttonSound();
        btn.userData.onPress();
      }
    }
  }
}

function updateXRInput(now) {
  for (const h of hands) {
    h.tipBall.visible = false;
    const tip = jointLocal(h.hand, 'index-finger-tip', v1);
    if (!tip) { h.sling = null; continue; }
    const thumb = jointLocal(h.hand, 'thumb-tip', v2);
    const pd = thumb ? tip.distanceTo(thumb) : 1;
    if (!h.pinching && pd < PINCH_ON) h.pinching = true;
    else if (h.pinching && pd > PINCH_OFF) h.pinching = false;
    const pinchPt = thumb ? tip.clone().add(thumb).multiplyScalar(0.5) : tip.clone();

    pokeButtons(tip, now);
    if (state === 'aim') slingUpdate(h, h.pinching, pinchPt);

    for (const name of ['index-finger-tip', 'middle-finger-tip']) {
      const p = name === 'index-finger-tip' ? tip.clone() : jointLocal(h.hand, name, new THREE.Vector3());
      if (!p) continue;
      pushHist(h.hist[name], now, p);
      if (state === 'aim' && !h.pinching && !h.sling && now > h.cooldown) {
        const vel = velOf(h.hist[name], now);
        if (tryFlick(p, vel)) h.cooldown = now + 400;
      }
    }
    // bolita en la punta del índice: se pone verde si vas lo bastante rápido
    const vel = velOf(h.hist['index-finger-tip'], now);
    const s = vel ? Math.hypot(vel.vx, vel.vz) : 0;
    h.tipBall.visible = true;
    h.tipBall.position.copy(root.localToWorld(tip.clone()));
    h.tipBall.material.color.set(s > FLICK_MIN ? 0x5dff8a : 0xffffff);
  }
  for (const pd of pads) {
    if (!pd.connected || pd.isHand) continue;
    pd.grip.getWorldPosition(v1);
    const p = root.worldToLocal(v1).clone();
    pokeButtons(p, now);
    pushHist(pd.hist, now, p);
    if (state === 'aim') {
      slingUpdate(pd, pd.pressing, p);
      if (!pd.pressing && !pd.sling) tryFlick(p, velOf(pd.hist, now), 0.04);
    }
  }
}

// ---------- Entrada: ratón / táctil (escritorio, para probar sin visor) ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane();
const mouse = { sling: null, down: false };
function pointerTable(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.setFromNormalAndCoplanarPoint(v3.set(0, 1, 0), root.getWorldPosition(v2));
  const hit = ray.ray.intersectPlane(plane, v1);
  return hit ? root.worldToLocal(hit.clone()) : null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  initAudio();
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(buttons.filter((b) => b.visible), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o && !o.userData.onPress) o = o.parent;
    if (o) { buttonSound(); o.userData.onPress(); return; }
  }
  mouse.down = true;
  if (state === 'aim') slingUpdate(mouse, true, pointerTable(e));
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (mouse.down && state === 'aim') slingUpdate(mouse, true, pointerTable(e));
});
addEventListener('pointerup', (e) => {
  mouse.down = false;
  if (mouse.sling) slingUpdate(mouse, false, pointerTable(e));
});

// ---------- Colocar la mesa delante del jugador (al entrar en el visor) ----------
let placeRequested = false;
function placeInFront() {
  const xrCam = renderer.xr.getCamera();
  xrCam.getWorldPosition(v1);
  xrCam.getWorldDirection(v2);
  v2.y = 0;
  if (v2.lengthSq() < 1e-6) v2.set(0, 0, -1);
  v2.normalize();
  root.position.copy(v1).addScaledVector(v2, 0.75);
  root.position.y = Math.max(0.45, v1.y - 0.5);
  root.rotation.y = Math.atan2(-v2.x, -v2.z);
}

// ---------- Botones de entrada al visor ----------
const ui = document.getElementById('ui');
let xrMode = null;
async function setupXRButtons() {
  if (!navigator.xr) { document.getElementById('xrinfo').textContent = 'Este navegador no tiene WebXR: aquí solo puedes probarlo con el ratón. Ábrelo en el navegador de las Meta Quest.'; return; }
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  const box = document.getElementById('xrbuttons');
  if (ar) box.appendChild(xrButton('Jugar en tu mesa (realidad mixta)', 'immersive-ar'));
  if (vr) box.appendChild(xrButton(ar ? 'Jugar en VR completa' : 'Jugar en VR', 'immersive-vr', !!ar));
  if (!ar && !vr) document.getElementById('xrinfo').textContent = 'No se ha encontrado un visor. Puedes probarlo con el ratón.';
}
function xrButton(label, mode, secondary) {
  const b = document.createElement('button');
  b.textContent = label;
  if (secondary) b.className = 'secondary';
  b.onclick = async () => {
    initAudio();
    try {
      const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking'] });
      xrMode = mode;
      session.addEventListener('end', onXREnd);
      await renderer.xr.setSession(session);
      onXRStart();
    } catch (err) {
      document.getElementById('xrinfo').textContent = 'No se pudo entrar: ' + err.message;
    }
  };
  return b;
}
function onXRStart() {
  ui.style.display = 'none';
  const passthrough = xrMode === 'immersive-ar';
  scene.background = passthrough ? null : bgColor;
  room.visible = !passthrough;
  tableLegs.visible = !passthrough;
  placeRequested = true;
}
function onXREnd() {
  ui.style.display = '';
  scene.background = bgColor;
  room.visible = true;
  tableLegs.visible = true;
  root.position.set(0, 0.8, 0);
  root.rotation.set(0, 0, 0);
}

// ---------- Bucle ----------
let lastT = 0;
renderer.setAnimationLoop((t) => {
  const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0);
  lastT = t;
  const now = performance.now();
  if (renderer.xr.isPresenting) {
    if (placeRequested) { placeInFront(); placeRequested = false; }
    updateXRInput(now);
  }
  updateGame(dt);
  syncMeshes(dt);
  confetti.update(dt);
  updateCushions(dt);
  stadium.update(dt, t / 1000);
  // aros de "te toca"
  const pulse = 0.35 + 0.25 * Math.sin(t / 250);
  world.bodies.forEach((b, i) => {
    const g = meshes[i]?.userData.glow;
    if (g) g.material.opacity = state === 'aim' && b.team === 0 ? pulse : 0;
  });
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Arranque: mesa preparada para el saque y botón JUGAR
setupMatch(world, 0);
rebuildBodies();
say('Pulsa JUGAR con el dedo');
drawBoard();
setupXRButtons();

// Para pruebas automáticas
window.__campioni = { root, renderer,
  tipWorld: (i) => { const j = hands[i].hand.joints?.['index-finger-tip']; if (!j || !j.visible) return null; const v = new THREE.Vector3(); j.getWorldPosition(v); return v.toArray(); },
  toWorld: (x, y, z) => root.localToWorld(new THREE.Vector3(x, y, z)).toArray(),
  world, get state() { return state; }, get score() { return score; }, startMatch, fire: (i, vx, vz) => fire(world.bodies[i], vx, vz) };
