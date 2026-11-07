import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { World, setupMatch, shoot, MAX_SHOT, FIELD, BALL_TYPES } from './physics.js';
import { buildArena } from './arena.js';
import { think } from './ai.js';
import { buildTable, buildCap, buildBall, buildShadow, textPanel, makeButton, TEAMS } from './visuals.js';
import { buildStadium } from './stadium.js';
import { createEffects } from './effects.js';
import { initAudio, hitSound, flickSound, goalSound, buttonSound, whistle, crowdOn, crowdVolume, toggleMusic, musicOn } from './audio.js';

// ---------- Ajustes de juego ----------
const GOALS_TO_WIN = 3;
const FLICK_MIN = 0.3; // m/s de la punta del dedo para que cuente como "toque"
const FLICK_GAIN = 1.3; // velocidad de la chapa = velocidad del dedo × esto
const SLING_GAIN = 11; // tirachinas: m/s por metro de estirón
const PINCH_ON = 0.018, PINCH_OFF = 0.035;

// ---------- Opciones (se recuerdan en este navegador) ----------
const settings = { music: true, stands: true, crowd: true, ball: 'garbanzo', sky: 'night' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('campioni') || '{}')); } catch (e) { /* sin almacenamiento */ }
function saveSettings() { try { localStorage.setItem('campioni', JSON.stringify(settings)); } catch (e) { /* nada */ } }

// ---------- Escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bgColor = new THREE.Color(0x1b2430);
scene.background = bgColor;
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(0, 1.22, 0.78);
camera.lookAt(0, 0.8, -0.12);

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a3a2a, 0.75));

// Estadio a tamaño real alrededor (VR completa y escritorio; en realidad mixta ves tu casa)
const arena = buildArena();
const room = arena.group;
scene.add(room);
function applySky() {
  const s = arena.setSky(settings.sky);
  scene.fog = room.visible ? new THREE.FogExp2(arena.fogColor, 0.007) : null;
  if (typeof sun !== 'undefined') sun.color.set(s.sun);
}

// Todo lo de la mesa cuelga de "root": se puede recolocar y subir/bajar
const root = new THREE.Group();
root.position.set(0, 0.8, 0);
scene.add(root);
// Luz principal tipo foco de estadio, con sombras reales. Cuelga de la mesa para seguirla.
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.position.set(0.5, 1.4, 0.35);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.7, bottom: -0.7, near: 0.2, far: 3 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.002;
root.add(sun, sun.target);
applySky();
const rim = new THREE.DirectionalLight(0x9fc3ff, 0.8); // contraluz frío desde el fondo
rim.position.set(-0.6, 0.9, -1.0);
root.add(rim, rim.target);
function shadowsOn(obj) {
  obj.traverse((o) => {
    if (!o.isMesh || o.material?.transparent || o.material?.isMeshBasicMaterial) return;
    o.castShadow = true; o.receiveShadow = true;
  });
}

const table = buildTable();
root.add(table);
shadowsOn(table);
const cushions = table.userData.cushions;
const stadium = buildStadium();
root.add(stadium.group);
shadowsOn(stadium.group);
stadium.group.visible = settings.stands;
const effects = createEffects([TEAMS[0].shirt, TEAMS[1].shirt]);
root.add(effects.group);
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
    shadowsOn(m);
    m.userData.flip = 0;
    bodyLayer.add(m);
    meshes.push(m);
  }
  syncMeshes(0);
}

const tmpAxis = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function syncMeshes(dt) {
  world.bodies.forEach((b, i) => {
    const m = meshes[i];
    m.position.set(b.x, b.y || 0, b.z);
    shadows[i].position.set(b.x + 0.002, 0.0004, b.z + 0.002);
    shadows[i].scale.setScalar(1 + (b.y || 0) * 30);
    shadows[i].material.opacity = 0.5 / (1 + (b.y || 0) * 60);
    if (b.kind !== 'ball') {
      // volteo animado para el tiro libre
      const target = b.flipped ? 1 : 0;
      m.userData.flip += (target - m.userData.flip) * Math.min(1, dt * 10);
      m.rotation.x = m.userData.flip * Math.PI;
      m.position.y = m.userData.flip * (m.userData.h || 0.0065);
    }
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

// ---------- Videomarcador (en lo alto, detrás de la grada del rival) ----------
const board = textPanel(0.46, 0.17, 1500);
board.position.set(0, 0.31, -FIELD.L / 2 - 0.25);
root.add(board);
{
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.19, 0.01), new THREE.MeshStandardMaterial({ color: 0x1a1f26, flatShading: true }));
  frame.position.set(0, 0.31, -FIELD.L / 2 - 0.256);
  root.add(frame);
  for (const x of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.22, 0.012), new THREE.MeshStandardMaterial({ color: 0x4a525c, flatShading: true }));
    leg.position.set(x, 0.11, -FIELD.L / 2 - 0.26);
    root.add(leg);
  }
}
let score = [0, 0];
let message = '';
let touchInfo = '';
function drawBoard() {
  board.userData.draw((g, w, h) => {
    g.fillStyle = '#05080c';
    g.fillRect(0, 0, w, h);
    // franja superior estilo LED
    g.fillStyle = '#0d1a2a'; g.fillRect(0, 0, w, h * 0.5);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 0.15)}px system-ui, sans-serif`;
    g.fillStyle = '#6ea2ff'; g.fillText(TEAMS[0].name, w * 0.18, h * 0.25);
    g.fillStyle = '#ff6b7d'; g.fillText(TEAMS[1].name, w * 0.82, h * 0.25);
    g.fillStyle = '#ffd34d';
    g.font = `900 ${Math.round(h * 0.34)}px system-ui, sans-serif`;
    g.fillText(`${score[0]} - ${score[1]}`, w / 2, h * 0.27);
    g.font = `bold ${Math.round(h * 0.12)}px system-ui, sans-serif`;
    g.fillStyle = touchInfo.includes('REPETICIÓN') || touchInfo === 'FALTA' ? '#ff4d4d' : '#7dffa1';
    g.fillText(touchInfo, w / 2, h * 0.62);
    g.font = `${Math.round(h * 0.12)}px system-ui, sans-serif`;
    g.fillStyle = '#ffffff';
    g.fillText(message, w / 2, h * 0.84);
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
addButton('MENÚ', -FIELD.W / 2 + 0.045, 0.03, nearZ, () => (menuOpen ? closeMenu() : openMenu()), { w: 0.07, color: '#7a4fd1' });
const playBtn = addButton('JUGAR', 0, 0.09, 0.05, () => startMatch(), { w: 0.14, h: 0.05, color: '#1f8a3e', tilt: -0.2 });

function shown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

// ---------- Menú (se abre con el botón MENÚ, todo se pulsa con el dedo) ----------
let menuOpen = false;
const menu = new THREE.Group();
menu.position.set(0, 0.13, FIELD.L / 2 - 0.1);
menu.rotation.x = -0.35;
menu.visible = false;
root.add(menu);
{
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.345), new THREE.MeshBasicMaterial({ color: 0x0b1118, transparent: true, opacity: 0.88 }));
  bg.position.y = -0.022;
  bg.position.z = -0.003;
  menu.add(bg);
}
const ballKeys = Object.keys(BALL_TYPES);
const menuItems = [];
function menuItem(i, labelFn, onPress, color = '#2f3a48') {
  const make = () => makeButton(labelFn(), 0.21, 0.034, color);
  const b = make();
  b.position.set(0, 0.115 - i * 0.045, 0);
  b.userData.onPress = () => { onPress(); relabel(); };
  const relabel = () => {
    const nb = make();
    b.remove(b.userData.panel);
    b.add(nb.userData.panel);
    b.userData.panel = nb.userData.panel;
  };
  b.userData.relabel = relabel;
  menu.add(b);
  buttons.push(b);
  menuItems.push(b);
  return b;
}
menuItem(0, () => '▶  Seguir jugando', () => closeMenu(), '#1f8a3e');
menuItem(1, () => `Música: ${settings.music ? 'SÍ' : 'NO'}`, () => { settings.music = !settings.music; toggleMusic(settings.music); saveSettings(); });
menuItem(2, () => `Ambiente grada: ${settings.crowd ? 'SÍ' : 'NO'}`, () => { settings.crowd = !settings.crowd; crowdOn(); crowdVolume(settings.crowd ? 1 : 0); saveSettings(); });
menuItem(3, () => `Gradas: ${settings.stands ? 'SÍ' : 'NO'}`, () => { settings.stands = !settings.stands; stadium.group.visible = settings.stands; saveSettings(); });
menuItem(4, () => `Balón: ${BALL_TYPES[settings.ball].name}`, () => setBall(ballKeys[(ballKeys.indexOf(settings.ball) + 1) % ballKeys.length]));
menuItem(5, () => `Cielo (VR): ${settings.sky === 'night' ? 'NOCHE' : 'ATARDECER'}`, () => { settings.sky = settings.sky === 'night' ? 'sunset' : 'night'; applySky(); saveSettings(); });
menuItem(6, () => '✕  Salir del juego', () => exitGame(), '#b3263a');
function openMenu() { menuOpen = true; menu.visible = true; aim.visible = false; }
function closeMenu() { menuOpen = false; menu.visible = false; }
function exitGame() {
  closeMenu();
  toggleMusic(false);
  const session = renderer.xr.getSession();
  if (session) session.end();
  else { state = 'menu'; ui.style.display = ''; playBtn.visible = true; say('Pulsa JUGAR con el dedo'); }
}

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
// menu | aim | cpu | moving | foul | goal | replay | end
const TOUCHES = 2; // toque de aproximación + toque de tiro
let state = 'menu';
let turn = 0;
let touchesLeft = TOUCHES;
let timer = 0;
let cpuGen = null, cpuShot = null;
let lastShooter = 0;

// Grabación del último disparo, para la repetición del gol
let rec = [];
let replayT = 0;
let recFps = 60;
function snapshot() {
  const f = new Float32Array(world.bodies.length * 4);
  world.bodies.forEach((b, i) => { f[i * 4] = b.x; f[i * 4 + 1] = b.z; f[i * 4 + 2] = b.angle; f[i * 4 + 3] = b.y || 0; });
  return f;
}

let freeKick = false;

function startMatch() {
  score = [0, 0];
  freeKick = false;
  setupMatch(world, 0, settings.ball);
  rebuildBodies();
  playBtn.visible = false;
  closeMenu();
  if (!renderer.xr.isPresenting) ui.style.display = 'none';
  whistle('short');
  crowdOn();
  crowdVolume(settings.crowd ? 1 : 0);
  if (settings.music) toggleMusic(true);
  giveTurn(0);
}

// Tiro libre: la chapa del equipo que recibió la falta más cercana al balón se da la vuelta.
// Con la chapa volteada, el balón sale por el aire según la fuerza del toque.
function startFreeKick(team) {
  for (const b of world.bodies) b.flipped = false;
  const ball = world.ball;
  let best = null, bd = Infinity;
  for (const b of world.bodies) {
    if (b.team !== team || b.kind !== 'cap') continue;
    const d = Math.hypot(b.x - ball.x, b.z - ball.z);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) { giveTurn(team); return; }
  best.flipped = true;
  freeKick = true;
  turn = team;
  touchesLeft = 1;
  touchInfo = `TIRO LIBRE · ${TEAMS[team].name}`;
  if (team === 0) { state = 'aim'; say('Tiro libre: dale a la chapa volteada, el balón sale por el aire'); }
  else { state = 'cpu'; timer = 1.0; cpuGen = null; cpuShot = null; say('Tiro libre del rival…'); }
  drawBoard();
}

function setBall(type) {
  settings.ball = type; saveSettings();
  const bt = BALL_TYPES[type];
  const b = world.ball;
  if (b) { b.r = bt.r; b.m = bt.m; b.mu = bt.mu; b.type = type; }
  rebuildBodies();
}

function giveTurn(team, touches = TOUCHES) {
  turn = team;
  touchesLeft = touches;
  nextTouch();
}
function nextTouch() {
  const n = TOUCHES - touchesLeft + 1;
  touchInfo = `${turn === 0 ? 'TÚ' : 'RIVAL'} · TOQUE ${n}/${TOUCHES}`;
  if (turn === 0) {
    state = 'aim';
    say(touchesLeft > 1 ? 'Aproxima: dale con el dedo a una chapa azul' : '¡Ahora tira!');
  } else {
    state = 'cpu'; timer = 0.7; cpuGen = null; cpuShot = null;
    say(touchesLeft > 1 ? 'El rival prepara la jugada…' : 'El rival va a tirar…');
  }
  drawBoard();
}

function fire(b, vx, vz) {
  shoot(b, vx, vz);
  flickSound();
  aim.visible = false;
  world.ballTouched = false;
  world.shotTeam = b.team;
  world.foul = null;
  lastShooter = b.team;
  state = 'moving';
  timer = 0;
  rec = [snapshot()];
  say('');
}

function afterGoalOrEnd() {
  if (score[0] >= GOALS_TO_WIN || score[1] >= GOALS_TO_WIN) {
    state = 'end';
    touchInfo = 'FINAL DEL PARTIDO';
    say(score[0] > score[1] ? '¡Campioni! Has ganado' : 'Ha ganado el rival');
    whistle('end');
    playBtn.visible = true;
  } else {
    const conceded = 1 - world.goal.scorer;
    freeKick = false;
    setupMatch(world, conceded, settings.ball);
    rebuildBodies();
    whistle('short');
    giveTurn(conceded);
  }
}

function updateGame(dt) {
  if (state === 'moving') {
    timer += dt;
    const ev = world.step(dt);
    rec.push(snapshot());
    if (rec.length > 900) rec.shift();
    for (const e of ev) {
      if (e.type === 'hit') hitSound(e.speed, e.a.kind === 'ball' || e.b.kind === 'ball' ? 'ball' : 'cap');
      else if (e.type === 'wall') { hitSound(e.speed, 'wall'); flashCushion(e.x, e.z, e.speed); }
      else if (e.type === 'net' || e.type === 'post') hitSound(e.speed * 0.4, 'net');
      else if (e.type === 'foul') { whistle('foul'); say(`¡Falta de ${TEAMS[e.team].name}! Tiro libre`); }
      else if (e.type === 'bounce') hitSound(Math.abs(e.speed) * 2, 'ball');
    }
    if (world.goal) {
      const s = world.goal.scorer;
      score[s]++;
      whistle('goal');
      goalSound();
      stadium.cheer(s);
      arena.cheer(s);
      confetti.burst(s === 0 ? -FIELD.L / 2 : FIELD.L / 2, s);
      say(s === 0 ? '¡GOOOOOOL!' : 'Gol del rival…');
      touchInfo = `${TEAMS[s].name} MARCA`;
      recFps = (rec.length - 1) / Math.max(timer, 0.05);
      state = 'goal';
      timer = 2.6;
      drawBoard();
    } else if (world.settled() || timer > 10) {
      world.stopAll();
      if (freeKick) { freeKick = false; for (const b of world.bodies) b.flipped = false; }
      if (world.foul !== null) {
        // falta: se acaba el turno y saca el rival
        state = 'foul';
        timer = 1.2;
        touchInfo = 'FALTA';
        drawBoard();
      } else {
        touchesLeft--;
        if (touchesLeft > 0) nextTouch();
        else giveTurn(1 - lastShooter);
      }
    }
  } else if (state === 'foul') {
    timer -= dt;
    if (timer <= 0) startFreeKick(1 - world.foul);
  } else if (state === 'goal') {
    timer -= dt;
    if (timer <= 0) {
      state = 'replay';
      replayT = 0;
      touchInfo = '● REPETICIÓN';
      say(world.goal.scorer === 0 ? 'Vaya golazo…' : 'Así entró…');
    }
  } else if (state === 'replay') {
    replayT += dt * 0.4; // cámara lenta
    const fi = Math.min(rec.length - 1, Math.floor(replayT * recFps));
    showFrame(rec[fi], dt * 0.4);
    const blink = Math.floor(replayT * 5) % 2 === 0 ? '● REPETICIÓN' : '○ REPETICIÓN';
    if (blink !== touchInfo) { touchInfo = blink; drawBoard(); }
    if (fi >= rec.length - 1 && replayT > (rec.length - 1) / recFps + 0.5) { lastFrame = null; afterGoalOrEnd(); }
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

// En la repetición las mallas siguen la grabación, no la física
let lastFrame = null;
function showFrame(f, dt) {
  world.bodies.forEach((b, i) => {
    const m = meshes[i];
    const x = f[i * 4], z = f[i * 4 + 1], y = f[i * 4 + 3];
    if (b.kind === 'ball' && lastFrame) {
      const dx = x - lastFrame[i * 4], dz = z - lastFrame[i * 4 + 1];
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) { tmpAxis.set(dz, 0, -dx).normalize(); tmpQ.setFromAxisAngle(tmpAxis, d / b.r); m.userData.ball.quaternion.premultiply(tmpQ); }
    }
    m.position.set(x, b.kind === 'ball' ? y : m.position.y, z);
    shadows[i].position.set(x + 0.002, 0.0004, z + 0.002);
    if (b.kind !== 'ball') m.rotation.y = -f[i * 4 + 2];
  });
  // estelas también en la repetición (velocidad sacada de la grabación)
  if (lastFrame && lastFrame !== f) {
    const fake = world.bodies.map((b, i) => ({ kind: b.kind, team: b.team, r: b.r, x: f[i * 4], z: f[i * 4 + 1], vx: (f[i * 4] - lastFrame[i * 4]) * recFps, vz: (f[i * 4 + 1] - lastFrame[i * 4 + 1]) * recFps }));
    effects.update(dt, fake);
  } else effects.update(dt, []);
  lastFrame = f;
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
    if (b.team !== 0 || menuOpen) continue;
    if (freeKick && !b.flipped) continue;
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
    if (!shown(btn)) continue;
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
  const hits = ray.intersectObjects(buttons.filter(shown), true);
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
  crowdOn();
  crowdVolume(settings.crowd ? 1 : 0);
  const passthrough = xrMode === 'immersive-ar';
  scene.background = passthrough ? null : bgColor;
  room.visible = !passthrough;
  tableLegs.visible = !passthrough;
  applySky();
  placeRequested = true;
}
function onXREnd() {
  ui.style.display = '';
  toggleMusic(false);
  crowdVolume(0);
  scene.background = bgColor;
  room.visible = true;
  tableLegs.visible = true;
  applySky();
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
  if (state !== 'replay') syncMeshes(dt);
  confetti.update(dt);
  updateCushions(dt);
  if (state !== 'replay') effects.update(dt, world.bodies);
  if (stadium.group.visible) stadium.update(dt, t / 1000);
  if (room.visible) arena.update(dt, t / 1000);
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
setupMatch(world, 0, settings.ball);
rebuildBodies();
say('Pulsa JUGAR con el dedo');
drawBoard();
setupXRButtons();

// Para pruebas automáticas
window.__campioni = { root, renderer, camera, applySky,
  tipWorld: (i) => { const j = hands[i].hand.joints?.['index-finger-tip']; if (!j || !j.visible) return null; const v = new THREE.Vector3(); j.getWorldPosition(v); return v.toArray(); },
  toWorld: (x, y, z) => root.localToWorld(new THREE.Vector3(x, y, z)).toArray(),
  world, get state() { return state; }, get touchesLeft() { return touchesLeft; }, get score() { return score; }, get freeKick() { return freeKick; }, startMatch, startFreeKick, openMenu, setBall, settings, fire: (i, vx, vz) => fire(world.bodies[i], vx, vz) };
