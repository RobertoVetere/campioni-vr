import * as THREE from 'three';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { World, setupMatch, shoot, MAX_SHOT, FIELD, BALL_TYPES, MAGNET, KEEPER } from './physics.js';
import { loadProgress, saveProgress, recordResult, unlockedKeys, UNLOCKS, DIFFICULTY } from './progress.js';
import { createFireworks } from './fireworks.js';
import { createGhostHand } from './ghosthand.js';
import { t, setLang, getLang, onLang } from './i18n.js';
import { log } from './logger.js';
import { buildArena } from './arena.js';
import { SURFACES, surfaceTexture } from './surfaces.js';
import { think } from './ai.js';
import { buildTable, buildCap, buildBall, buildShadow, textPanel, makeButton, TEAMS } from './visuals.js';
import { buildStadium } from './stadium.js';
import { createEffects } from './effects.js';
import { initAudio, hitSound, flickSound, goalSound, buttonSound, whistle, crowdOn, crowdVolume, crowdSwell, playSample, toggleMusic, musicOn } from './audio.js';

// ---------- Ajustes de juego ----------
const GOALS_TO_WIN = 3;
// Toque con el dedo. El visor ve la punta del dedo a 60-90 Hz y suavizada, así que un toque
// de uña real (muy rápido y corto) le llega mucho más lento. Por eso usamos la velocidad PUNTA
// y una curva de potencia: toque suave = pase corto, toque rápido = tiro a tope.
const FLICK_MIN = 0.22; // m/s de la punta del dedo para que cuente como toque
const FLICK_FULL = 1.1; // m/s de dedo (medidos) que ya dan la potencia máxima
const SHOT_MIN = 0.45; // m/s: lo mínimo que sale una chapa con un toque válido
const FINGER_POWER = { suave: 0.75, normal: 1, fuerte: 1.35 };
function flickPower(fingerSpeed) {
  const k = Math.min(1, Math.max(0, (fingerSpeed - FLICK_MIN) / (FLICK_FULL - FLICK_MIN)));
  const v = SHOT_MIN + (MAX_SHOT - SHOT_MIN) * Math.pow(k, 0.8);
  return Math.min(MAX_SHOT, v * (FINGER_POWER[settings.finger] || 1));
}
const SLING_GAIN = 11; // tirachinas: m/s por metro de estirón
const PINCH_ON = 0.018, PINCH_OFF = 0.035;
const MOVE_LIMIT = 0.06; // con la palma, cada arrastre llega como mucho a esto (la que lleva el balón: por turno)
const PALM_HEIGHT = 0.07; // la palma tiene que ir a ras de mesa (como mucho a esta altura)

// ---------- Opciones (se recuerdan en este navegador) ----------
const settings = { music: true, stands: false, crowd: true, ball: 'garbanzo', sky: 'night', finger: 'normal', surface: 'tapete', keeper: 'manual', shootHand: 'right', difficulty: 'normal', log: false, zoom: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('campioni') || '{}')); } catch (e) { /* sin almacenamiento */ }
function saveSettings() { try { localStorage.setItem('campioni', JSON.stringify(settings)); } catch (e) { /* nada */ } }
if (new URLSearchParams(location.search).get('log') === '1') settings.log = true;
log.enable(settings.log);
// progreso: victorias, récords y desbloqueos. Si algo guardado no está desbloqueado, se vuelve a lo de serie.
const progress = loadProgress();
if (!unlockedKeys(progress, 'ball').includes(settings.ball)) settings.ball = 'garbanzo';
if (!unlockedKeys(progress, 'surface').includes(settings.surface)) settings.surface = 'tapete';
if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'normal';
// modo de juego: 'match' (partido), 'penalties' (tanda de penaltis) o 'tutorial'
let mode = 'match';
const ballName = (k) => t(`ball.${k}`);
const surfName = (k) => t(`surf.${k}`);
const diffName = (k) => t(`diff.${k}`);

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
// Dónde está la mesa "de verdad" (colocada/calibrada). Sobre esto se aplica el acercamiento
// (zoom) en las jugadas a balón parado: la mesa se agranda y trae la jugada hacia ti, sin girar
// nada y despacio, para que no maree. Toda la entrada de manos va en coordenadas de la mesa.
const tableBase = { pos: new THREE.Vector3(0, 0.8, 0), rotY: 0 };
const zoom = { s: 1, target: 1, focus: new THREE.Vector3(), anchor: new THREE.Vector3(0, 0, 0.12), cur: new THREE.Vector3(0, 0, 0.12) };
function zoomScale() { return root.scale.x; }
function zoomTo(scale, focusX = 0, focusZ = 0, anchorZ = 0.12) {
  if (!settings.zoom) scale = 1;
  zoom.target = scale;
  zoom.focus.set(focusX, 0, focusZ);
  zoom.anchor.set(0, 0, anchorZ);
  if (scale !== 1) log.ev('zoom', { scale, fx: focusX, fz: focusZ });
}
function applyTable(dt) {
  const k = 1 - Math.exp(-dt * 3.2); // ~0,8 s para llegar
  zoom.s += (zoom.target - zoom.s) * k;
  zoom.cur.lerp(zoom.target === 1 ? zoom.anchor : zoom.focus, k);
  const S = zoom.s;
  // el punto enfocado (cur) queda donde está el ancla: con S=1 y cur=ancla no hay desplazamiento
  const off = new THREE.Vector3().copy(zoom.anchor).sub(zoom.cur.clone().multiplyScalar(S));
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), tableBase.rotY);
  root.position.copy(tableBase.pos).add(off);
  root.rotation.y = tableBase.rotY;
  root.scale.setScalar(S);
}
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
    if (!o.isMesh || o.userData.noShadow || o.material?.transparent || o.material?.isMeshBasicMaterial) return;
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
const tableFireworks = createFireworks(root, { scale: 0.18, size: 0.012 });
const arenaFireworks = createFireworks(scene, { scale: 9, size: 0.02, max: 2500 });
function celebrate(team, big = false) {
  const z = team === 0 ? -FIELD.L / 2 : FIELD.L / 2;
  tableFireworks.launch(big ? 9 : 5, { x: 0, y: 0.03, z, w: 0.3, d: 0.1 });
  if (room.visible) arenaFireworks.launch(big ? 14 : 8, { x: 0, y: 2, z: 0, w: 70, d: 90 });
}

// Cambia el campo: textura, colores de la mesa y física
function setSurface(type) {
  const S = SURFACES[type] || SURFACES.tapete;
  settings.surface = SURFACES[type] ? type : 'tapete';
  const felt = table.userData.felt;
  felt.material.map = surfaceTexture(settings.surface);
  felt.material.needsUpdate = true;
  table.userData.rail.color.set(S.rail);
  table.userData.wood.color.set(S.board);
  for (const c of cushions) c.mesh.material.color.set(S.cushion);
  world.surf = { mu: S.mu, jitter: S.jitter };
  effects.setMarks(S.marks);
  effects.clear();
}
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

function applyKeeperMode() {
  const k = world.bodies.find((b) => b.kin && b.team === 0);
  if (k) k.auto = settings.keeper === 'auto';
}
function rebuildBodies() {
  applyKeeperMode();
  // las chapas de antes ya no existen: si una mano seguía "agarrando" una, bloqueaba el toque
  if (typeof hands !== 'undefined') for (const h of hands) { h.drag = null; h.sling = null; }
  if (typeof pads !== 'undefined') for (const p of pads) p.sling = null;
  if (typeof mouse !== 'undefined') mouse.sling = null;
  selected = null;
  lockedCap = null;
  bodyLayer.clear();
  meshes = []; shadows = [];
  for (const b of world.bodies) {
    const s = buildShadow(b.r);
    bodyLayer.add(s);
    shadows.push(s);
    const m = b.kind === 'ball' ? buildBall(b) : buildCap(b);
    shadowsOn(m);
    m.userData.flip = 0;
    m.userData.phase = Math.random() * 6.28;
    if (b.kind !== 'ball') {
      // radio de alcance del imán (se ve en tu turno; más fuerte en la chapa seleccionada)
      const R = b.r + (b.kind === 'keeper' ? MAGNET.reach * 0.6 : MAGNET.reach);
      const reach = new THREE.Mesh(new THREE.RingGeometry(R - 0.0012, R, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      reach.rotation.x = -Math.PI / 2; reach.position.y = 0.0007;
      m.add(reach);
      m.userData.reach = reach;
      if (b.team === 0 && !b.kin) {
        // piloto: palito fino + bombilla que brilla
        const pilot = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.032, 6), new THREE.MeshBasicMaterial({ color: 0xcfd8e3, toneMapped: false }));
        stem.position.y = 0.016 + (m.userData.h || 0.0065);
        const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0065, 1), new THREE.MeshBasicMaterial({ color: 0x8fffb0, toneMapped: false }));
        bulb.position.y = 0.045;
        const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.011, 1), new THREE.MeshBasicMaterial({ color: 0x8fffb0, transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }));
        halo.position.y = 0.045;
        pilot.add(stem, bulb, halo);
        pilot.visible = false;
        m.add(pilot);
        m.userData.pilot = { group: pilot, bulb, halo };
      }
    }
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
    if (b.kin) {
      // portero en su barra: no gira ni se inclina; el del rival mira hacia el otro lado
      m.rotation.set(0, b.team === 0 ? 0 : Math.PI, 0);
      m.position.y = 0;
    } else if (b.kind !== 'ball') {
      // volteo animado para el tiro libre
      const target = b.flipped ? 1 : 0;
      m.userData.flip += (target - m.userData.flip) * Math.min(1, dt * 10);
      m.rotation.x = m.userData.flip * Math.PI;
      m.position.y = m.userData.flip * (m.userData.h || 0.0065) + (b.drag ? 0.004 : 0);
      // "vida": respiran y se inclinan un poco hacia el balón cuando están quietas (solo visual)
      if (!b.flipped && !b.drag && b.vx === 0 && b.vz === 0 && world.ball) {
        const tt = performance.now() / 1000 + m.userData.phase;
        const dx = world.ball.x - b.x, dz = world.ball.z - b.z, d = Math.hypot(dx, dz) || 1;
        const lean = Math.max(0, 1 - d / 0.25) * 0.09;
        m.position.y += 0.0006 + Math.sin(tt * 2.1) * 0.0006;
        m.rotation.x += (dz / d) * lean + Math.sin(tt * 1.3) * 0.015;
        m.rotation.z = -(dx / d) * lean + Math.cos(tt * 1.7) * 0.015;
      } else m.rotation.z = 0;
    }
    if (b.kind === 'ball') {
      const s = Math.hypot(b.vx, b.vz);
      if (s > 0 && dt > 0) {
        tmpAxis.set(b.vz, 0, -b.vx).normalize();
        tmpQ.setFromAxisAngle(tmpAxis, (s * dt) / b.r);
        m.userData.ball.quaternion.premultiply(tmpQ);
      }
    } else if (!b.kin) {
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
    g.fillStyle = touchInfo.includes(t('replay')) || touchInfo === t('foulT') ? '#ff4d4d' : '#7dffa1';
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
addButton('▲', FIELD.W / 2 - 0.02, 0.03, nearZ, () => (tableBase.pos.y += 0.02), { w: 0.04, color: '#444c58' });
addButton('▼', FIELD.W / 2 - 0.07, 0.03, nearZ, () => (tableBase.pos.y -= 0.02), { w: 0.04, color: '#444c58' });
const tableLabels = [];
function labeled(key, btn, w, h, color) { tableLabels.push({ key, btn, w, h, color }); return btn; }
labeled('btn.here', addButton(t('btn.here'), FIELD.W / 2 - 0.13, 0.03, nearZ, () => (placeRequested = true), { w: 0.06, color: '#444c58' }), 0.06, undefined, '#444c58');
labeled('btn.menu', addButton(t('btn.menu'), -FIELD.W / 2 + 0.045, 0.03, nearZ, () => (menuOpen ? closeMenu() : openMenu()), { w: 0.07, color: '#7a4fd1' }), 0.07, undefined, '#7a4fd1');
const playBtn = labeled('btn.match', addButton(t('btn.match'), -0.08, 0.09, 0.05, () => startMatch(), { w: 0.14, h: 0.05, color: '#1f8a3e', tilt: -0.2 }), 0.14, 0.05, '#1f8a3e');
const penBtn = labeled('btn.penalties', addButton(t('btn.penalties'), 0.08, 0.09, 0.05, () => startPenalties(), { w: 0.14, h: 0.05, color: '#c8102e', tilt: -0.2 }), 0.14, 0.05, '#c8102e');
// SALTAR el tutorial, en la propia mesa (donde están las manos)
const tableSkip = labeled('btn.skip', addButton(t('btn.skip'), 0, 0.09, 0.05, () => { if (mode === 'tutorial') endTutorial(); }, { w: 0.16, h: 0.055, color: '#b3263a', tilt: -0.2 }), 0.16, 0.055, '#b3263a');
tableSkip.visible = false;
function relabelTable() {
  for (const L of tableLabels) {
    const nb = makeButton(t(L.key), L.w, L.h, L.color);
    L.btn.remove(L.btn.userData.panel);
    L.btn.add(nb.userData.panel);
    L.btn.userData.panel = nb.userData.panel;
  }
}
function hideStartButtons() { playBtn.visible = false; penBtn.visible = false; }
function showStartButtons() { playBtn.visible = true; penBtn.visible = true; }

function shown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

// ---------- Menú con submenús. Se abre delante de tus ojos, a la altura de la vista ----------
let menuOpen = false;
const menu = new THREE.Group();
menu.visible = false;
scene.add(menu);
const menuBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x0b1118, toneMapped: false, transparent: true, opacity: 0.94 }));
menuBg.renderOrder = 4;
menu.add(menuBg);
const menuTitle = textPanel(0.3, 0.045, 2000);
menu.add(menuTitle);
const ballKeys = Object.keys(BALL_TYPES);
const surfKeys = Object.keys(SURFACES);
const cycle = (arr, v) => arr[(arr.indexOf(v) + 1) % arr.length];
const yes = (v) => t(v ? 'yes' : 'no');
const PAGES = {
  main: {
    title: () => t('menu.main'),
    items: () => [
      [t('menu.resume'), () => closeMenu(), '#1f8a3e'],
      ...(mode === 'tutorial' ? [[t('btn.skip') + ' TUTORIAL', () => { closeMenu(); endTutorial(); }, '#b3263a']] : []),
      [t('menu.game'), () => showPage('partido')],
      [t('menu.sound'), () => showPage('sonido')],
      [t('menu.stadium'), () => showPage('estadio')],
      [t('menu.controls'), () => showPage('controles')],
      [t('menu.lang'), () => setLang(getLang() === 'en' ? 'es' : 'en'), '#2f6f8f'],
      [t('menu.quit'), () => exitGame(), '#b3263a'],
    ],
  },
  partido: {
    title: () => t('menu.gameT'),
    items: () => {
      const balls = unlockedKeys(progress, 'ball'), fields = unlockedKeys(progress, 'surface');
      const lockedB = ballKeys.length - balls.length, lockedF = surfKeys.length - fields.length;
      return [
        [t('menu.play'), () => startMatch(), '#1f8a3e'],
        [t('menu.pens'), () => startPenalties(), '#c8102e'],
        [t('menu.rival', { v: diffName(settings.difficulty) }), () => { settings.difficulty = cycle(Object.keys(DIFFICULTY), settings.difficulty); applyDifficulty(); saveSettings(); }],
        [t('menu.ball', { v: ballName(settings.ball) }) + (lockedB ? `  (+${lockedB}🔒)` : ''), () => { setBall(cycle(balls, settings.ball)); }],
        [t('menu.field', { v: surfName(settings.surface) }) + (lockedF ? `  (+${lockedF}🔒)` : ''), () => { setSurface(cycle(fields, settings.surface)); saveSettings(); }],
        [t('menu.tutorial'), () => startTutorial(), '#2f6f8f'],
        [t('menu.practice'), () => startPractice(), '#2f6f8f'],
        [t('menu.records'), () => showPage('records')],
        [t('menu.back'), () => showPage('main'), '#444c58'],
      ];
    },
  },
  records: {
    title: () => t('menu.recordsT'),
    items: () => {
      const p = progress;
      const next = UNLOCKS.filter((u) => !u.ok(p)).slice(0, 2)
        .map((u) => [`🔒 ${u.kind === 'ball' ? ballName(u.key) : surfName(u.key)}: ${t(`need.${u.key}`)}`, () => {}, '#2a2f38']);
      return [
        [t('rec.wins', { w: p.wins, l: p.losses }), () => {}, '#2a2f38'],
        [t('rec.streak', { s: p.bestStreak, d: p.bestDiff }), () => {}, '#2a2f38'],
        [t('rec.pens', { p: p.penWins }), () => {}, '#2a2f38'],
        ...next,
        [t('menu.back'), () => showPage('partido'), '#444c58'],
      ];
    },
  },
  sonido: {
    title: () => t('menu.soundT'),
    items: () => [
      [t('menu.music', { v: yes(settings.music) }), () => { settings.music = !settings.music; toggleMusic(settings.music); saveSettings(); }],
      [t('menu.crowd', { v: yes(settings.crowd) }), () => { settings.crowd = !settings.crowd; crowdOn(); crowdVolume(settings.crowd ? 1 : 0); saveSettings(); }],
      [t('menu.back'), () => showPage('main'), '#444c58'],
    ],
  },
  estadio: {
    title: () => t('menu.stadiumT'),
    items: () => [
      [t('menu.stands', { v: yes(settings.stands) }), () => { settings.stands = !settings.stands; stadium.group.visible = settings.stands; saveSettings(); }],
      [t('menu.sky', { v: t(settings.sky === 'night' ? 'sky.night' : 'sky.sunset') }), () => { settings.sky = settings.sky === 'night' ? 'sunset' : 'night'; applySky(); saveSettings(); }],
      [t('menu.back'), () => showPage('main'), '#444c58'],
    ],
  },
  controles: {
    title: () => t('menu.controlsT'),
    items: () => [
      [t('menu.hand', { v: t(settings.shootHand === 'right' ? 'hand.right' : 'hand.left') }), () => { settings.shootHand = settings.shootHand === 'right' ? 'left' : 'right'; saveSettings(); }],
      [t('menu.finger', { v: t(`finger.${settings.finger}`) }), () => { settings.finger = cycle(['suave', 'normal', 'fuerte'], settings.finger); saveSettings(); }],
      [t('menu.keeper', { v: t(settings.keeper === 'auto' ? 'keeper.auto' : 'keeper.manual') }), () => { settings.keeper = settings.keeper === 'auto' ? 'manual' : 'auto'; applyKeeperMode(); saveSettings(); }],
      [t('menu.calib'), () => startCalib(), '#2f6f8f'],
      [t('menu.zoom', { v: yes(settings.zoom) }), () => { settings.zoom = !settings.zoom; if (!settings.zoom) zoomTo(1); saveSettings(); }],
      [`${t('menu.log')}: ${yes(settings.log)}`, () => { settings.log = !settings.log; log.enable(settings.log); log.setMeta({ settings }); saveSettings(); }, '#5a2f2f'],
      [t('menu.back'), () => showPage('main'), '#444c58'],
    ],
  },
};
const BTN_W = 0.3, BTN_H = 0.052, GAP = 0.014;
let menuPage = 'main';
let menuButtons = [];
function showPage(name) {
  menuPage = name;
  for (const b of menuButtons) { menu.remove(b); buttons.splice(buttons.indexOf(b), 1); }
  menuButtons = [];
  const items = PAGES[name].items();
  const total = items.length * BTN_H + (items.length - 1) * GAP;
  items.forEach(([label, fn, color = '#2f3a48'], k) => {
    const b = makeButton(label, BTN_W, BTN_H, color);
    b.position.set(0, total / 2 - BTN_H / 2 - k * (BTN_H + GAP), 0.002);
    // al pulsar: hace lo suyo y se redibuja la página (para ver el valor nuevo)
    b.userData.onPress = () => { fn(); if (menuOpen && menuPage === name) showPage(name); };
    menu.add(b);
    buttons.push(b);
    menuButtons.push(b);
  });
  // el menú se dibuja siempre por encima de todo (nunca lo tapa la mesa ni el estadio)
  menu.traverse((o) => {
    if (!o.material) return;
    o.material.depthTest = false;
    o.renderOrder = o === menuBg ? 20 : 21;
  });
  menuBg.scale.set(BTN_W + 0.04, total + 0.1, 1);
  menuBg.position.set(0, 0.022, 0);
  menuTitle.position.set(0, total / 2 + 0.042, 0.002);
  menuTitle.userData.draw((g, w, h) => {
    g.fillStyle = '#ffd34d'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
    g.fillText(PAGES[name].title(), w / 2, h / 2 + 2);
  });
}
// colocar el menú delante de los ojos, a 45 cm, mirándote
function placeMenu() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const head = new THREE.Vector3(), dir = new THREE.Vector3();
  cam.getWorldPosition(head);
  cam.getWorldDirection(dir);
  if (renderer.xr.isPresenting) {
    // en el visor: recto delante, a la altura de los ojos (no hay que mirar abajo)
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    menu.position.copy(head).addScaledVector(dir, 0.45);
    menu.position.y = head.y - 0.04;
    menu.lookAt(head.x, menu.position.y, head.z);
  } else {
    // en el escritorio: en el centro de la vista
    menu.position.copy(head).addScaledVector(dir, 0.75);
    menu.lookAt(head);
  }
}
function openMenu() { menuOpen = true; placeMenu(); showPage('main'); menu.visible = true; aim.visible = false; info.userData.wasVisible = info.visible; info.visible = false; }
function closeMenu() {
  menuOpen = false; menu.visible = false;
  // si estabas en el tutorial o calibrando, vuelve su panel
  if (info.userData.wasVisible && (mode === 'tutorial' || state === 'calib')) info.visible = true;
  info.userData.wasVisible = false;
}
function exitGame() {
  closeMenu();
  toggleMusic(false);
  const session = renderer.xr.getSession();
  if (session) session.end();
  else { state = 'menu'; ui.style.display = ''; showStartButtons(); say(t('pick')); }
}

// ---------- Panel del registro: últimos eventos, a la izquierda de la mesa ----------
const logHud = textPanel(0.3, 0.13, 1600);
logHud.position.set(-FIELD.W / 2 - 0.2, 0.12, 0.1);
logHud.rotation.y = 0.6;
logHud.visible = false;
root.add(logHud);
let logHudT = 0;
function updateLogHud(now) {
  logHud.visible = log.enabled;
  if (!log.enabled || now - logHudT < 400) return;
  logHudT = now;
  logHud.userData.draw((g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff4d4d'; g.font = `bold ${Math.round(h * 0.1)}px monospace`;
    g.fillText(`● REC ${log.session.slice(-4)} · ${__COMMIT__} · ${log.status}`, 10, h * 0.12);
    g.fillStyle = '#d7ffd9'; g.font = `${Math.round(h * 0.085)}px monospace`;
    log.recent.forEach((l, i) => g.fillText(l.slice(0, 46), 10, h * (0.26 + i * 0.12)));
  });
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
function showAim(b, vx, vz, loft = 0) {
  const s = Math.hypot(vx, vz);
  if (s < 1e-3) { aim.visible = false; return; }
  const len = 0.03 + (s / MAX_SHOT) * 0.18;
  aim.visible = true;
  aim.position.set(b.x, 0.004, b.z);
  aim.rotation.order = 'YXZ';
  aim.rotation.y = Math.atan2(-vx, -vz);
  aim.rotation.x = loft * 0.75; // la flecha se levanta si el tiro va por arriba
  aim.userData.shaft.scale.z = len;
  aim.userData.shaft.position.z = -len / 2;
  aim.userData.head.position.z = -len;
  const hot = s / MAX_SHOT;
  aim.userData.shaft.material.color.setHSL(0.15 - hot * 0.15, 1, 0.6);
}

// ---------- Guía de puntería (penaltis): adónde irá el balón según dónde pongas el dedo ----------
const guide = (() => {
  const n = 14, pts = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const m = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe066, size: 0.006, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
  m.visible = false; m.frustumCulled = false;
  root.add(m);
  return {
    show(x, z, dx, dz) {
      for (let i = 0; i < n; i++) { const d = 0.012 + i * 0.012; pts.set([x + dx * d, 0.004, z + dz * d], i * 3); }
      geo.attributes.position.needsUpdate = true; m.visible = true;
    },
    hide() { m.visible = false; },
  };
})();
function updateGuide(tips) {
  const k = lockedCap;
  if (state !== 'aim' || !k || !k.aimAssist || !world.ball) { guide.hide(); return; }
  // con el tirachinas: la dirección del estirón; con el dedo: del dedo al centro de la chapa
  const sl = [...hands, mouse].find((h) => h.sling);
  let dx, dz;
  if (sl && Math.hypot(sl.sling.vx || 0, sl.sling.vz || 0) > 0.05) { dx = sl.sling.vx; dz = sl.sling.vz; }
  else {
    const tip = tips.find((p) => p && p.y < 0.07 && Math.hypot(p.x - k.x, p.z - k.z) < 0.12 && Math.hypot(p.x - k.x, p.z - k.z) > k.r * 0.6);
    if (!tip) { guide.hide(); return; }
    dx = k.x - tip.x; dz = k.z - tip.z;
  }
  const l = Math.hypot(dx, dz) || 1;
  guide.show(world.ball.x, world.ball.z, dx / l, dz / l);
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
let lastFlick = '';
let loggedState = '';
let timeScale = 1, slowFired = false;
let selected = null; // chapa elegida por el jugador para el siguiente toque
let lockedCap = null; // en tiro libre o penalti solo puede tirar esta

// dónde estaba cada chapa al empezar el turno (la palma solo la mueve un poco desde ahí)
function setAnchors() {
  for (const b of world.bodies) { b.ax = b.x; b.az = b.z; }
  world.shotTeam = null; // mover con la palma nunca es falta
  world.foul = null;
}

function autoSelect() {
  const ball = world.ball;
  let best = null, bd = Infinity;
  for (const b of world.bodies) if (b.team === 0 && b.kind === 'cap') { const d = Math.hypot(b.x - ball.x, b.z - ball.z); if (d < bd) { bd = d; best = b; } }
  selected = best;
}

function select(b, src = '?') {
  if (!b || selected === b) return;
  selected = b;
  log.ev('select', { cap: b.num, src });
  buttonSound();
  tutEvent('select');
}

// aparta las chapas que estén en un círculo (para colocar faltas y penaltis)
function clearSpot(x, z, rad, keep) {
  for (const b of world.bodies) {
    if (keep.includes(b)) continue;
    const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
    if (d < rad + b.r) {
      const k = (rad + b.r + 0.004) / (d || 1);
      b.x = x + (d ? dx : 1) * k; b.z = z + (d ? dz : 0) * k;
      b.x = Math.max(-FIELD.W / 2 + b.r, Math.min(FIELD.W / 2 - b.r, b.x));
    }
  }
}

function applyDifficulty() { KEEPER.autoSpeed = DIFFICULTY[settings.difficulty].keeper; }
function startMatchZoomReset() { zoomTo(1); }
function startMatch() {
  startMatchZoomReset();
  log.setMeta({ settings, tableY: tableBase.pos.y });
  log.ev('start', { mode: 'match', diff: settings.difficulty });
  mode = 'match';
  hideStartButtons();
  applyDifficulty();
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
  // la chapa se pone directamente detrás del balón, mirando a la portería rival
  const back = team === 0 ? 1 : -1;
  best.x = ball.x; best.z = ball.z + back * (best.r + ball.r + 0.004);
  best.x = Math.max(-FIELD.W / 2 + best.r, Math.min(FIELD.W / 2 - best.r, best.x));
  clearSpot(ball.x, ball.z, 0.035, [best, ball]);
  best.flipped = true;
  best.locked = true;
  zoomTo(1.6, ball.x * 0.6, ball.z, 0.05);
  lockedCap = best;
  selected = team === 0 ? best : null;
  freeKick = true;
  turn = team;
  touchesLeft = 1;
  touchInfo = t('fk', { t: TEAMS[team].name });
  if (team === 0) { state = 'aim'; say(t('fk.you')); }
  else { state = 'cpu'; timer = 0.8; cpuPrep = false; cpuGen = null; cpuShot = null; say(t('fk.cpu')); }
  setAnchors();
  drawBoard();
}

// Penalti: falta dentro del área que ataca el equipo que la recibe
function inAttackArea(team, p) {
  if (!p) return false;
  const lineZ = team === 0 ? -FIELD.L / 2 : FIELD.L / 2;
  return Math.abs(p.x) < (FIELD.goalW + 0.14) / 2 && Math.abs(p.z - lineZ) < 0.12;
}
function startPenalty(team) {
  for (const b of world.bodies) { b.flipped = false; b.locked = false; b.vx = b.vz = 0; }
  const dir = team === 0 ? -1 : 1; // hacia dónde ataca
  const spotZ = dir * (FIELD.L / 2 - PEN_SPOT);
  const ball = world.ball;
  ball.x = 0; ball.z = spotZ; ball.y = 0; ball.vy = 0;
  let kicker = null, bd = Infinity;
  for (const b of world.bodies) if (b.team === team && b.kind === 'cap') { const d = Math.hypot(b.x, b.z - spotZ); if (d < bd) { bd = d; kicker = b; } }
  // puntería asistida: el balón sale en la dirección en la que mueves la chapa
  kicker.x = 0; kicker.z = spotZ - dir * (kicker.r + ball.r + 0.02);
  kicker.aimAssist = true;
  const keeper = world.bodies.find((b) => b.team !== team && b.kind === 'keeper');
  keeper.x = 0; keeper.tx = 0; keeper.z = dir * (FIELD.L / 2 - keeper.r - 0.002);
  keeper.homeZ = keeper.z; // en el penalti, el portero sobre la línea (si no, la física lo devuelve a su sitio)
  // todos los demás fuera del área
  const lineZ = dir * FIELD.L / 2;
  for (const b of world.bodies) {
    if (b === kicker || b === keeper || b === ball) continue;
    if (Math.abs(b.z - lineZ) < 0.13 && Math.abs(b.x) < (FIELD.goalW + 0.14) / 2 + b.r) b.z = lineZ - dir * (0.13 + b.r);
  }
  kicker.locked = true;
  lockedCap = kicker;
  selected = team === 0 ? kicker : null;
  freeKick = true; // un único toque especial
  turn = team; touchesLeft = 1;
  whistle('goal');
  // acercar la jugada: tu tiro -> el área rival viene hacia ti; su tiro -> tu portería y la palanca
  if (team === 0) zoomTo(2.0, 0, spotZ + 0.03, 0.02);
  else zoomTo(1.6, 0, FIELD.L / 2 - 0.08, 0.02);
  touchInfo = t('pk', { t: TEAMS[team].name });
  if (team === 0) { state = 'aim'; say(t('pk.you')); }
  else { state = 'cpu'; timer = 1.0; cpuPrep = false; cpuGen = null; cpuShot = null; say(t('pk.cpu')); }
  setAnchors();
  drawBoard();
}

// ---------- Tanda de penaltis: 5 por equipo, alternos; si hay empate, muerte súbita ----------
let pen = null;
const PEN_SPOT = 0.15; // distancia del punto de penalti a la línea de gol
function startPenalties() {
  log.ev('start', { mode: 'penalties' });
  mode = 'penalties';
  hideStartButtons();
  closeMenu();
  applyDifficulty();
  if (!renderer.xr.isPresenting) ui.style.display = 'none';
  pen = { kicks: [[], []] };
  score = [0, 0];
  crowdOn();
  crowdVolume(settings.crowd ? 1 : 0);
  if (settings.music) toggleMusic(true);
  penaltyKick(0);
}
function penaltyKick(team) {
  // en el campo solo los dos porteros, el lanzador y el balón
  setupMatch(world, team, settings.ball);
  const kicker = world.bodies.find((b) => b.team === team && b.kind === 'cap');
  world.bodies = world.bodies.filter((b) => b.kin || b === kicker || b === world.ball);
  rebuildBodies();
  startPenalty(team);
  touchInfo = t('pens', { a: penDots(0), b: penDots(1) });
  drawBoard();
}
function penDots(team) {
  const k = pen.kicks[team];
  const n = Math.max(5, k.length);
  return Array.from({ length: n }, (_, i) => (i < k.length ? (k[i] ? '●' : '✕') : '○')).join('');
}
function penaltyResult(scored) {
  const team = lastShooter;
  { const bl = world.ball, k = world.bodies.find((b) => b.kin && b.team !== team);
    log.ev('pen_result', { team, scored, bx: bl.x, bz: bl.z, by: bl.y, kx: k?.x, why: scored ? 'gol' : Math.abs(bl.x) > FIELD.goalW / 2 ? 'fuera' : 'parada_o_corto' }); }
  pen.kicks[team].push(scored);
  if (!scored) { say(t(team === 0 ? 'pens.miss' : 'pens.save')); if (team === 1) { crowdSwell(0.8); celebrate(0); } }
  const [a, b] = pen.kicks;
  const ga = a.filter(Boolean).length, gb = b.filter(Boolean).length;
  score = [ga, gb];
  let over = false;
  if (a.length <= 5 && b.length <= 5) {
    const remA = 5 - a.length, remB = 5 - b.length;
    if (ga + remA < gb || gb + remB < ga) over = true;
  }
  if (a.length >= 5 && a.length === b.length && ga !== gb) over = true;
  touchInfo = t('pens', { a: penDots(0), b: penDots(1) });
  drawBoard();
  if (over) { finishGame(ga > gb); return; }
  const next = a.length > b.length ? 1 : 0;
  state = 'penpause';
  timer = 1.3;
  pen.next = next;
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
  if (team !== 0) selected = null;
  touchesLeft = touches;
  nextTouch();
}
let cpuPrep = false;
function nextTouch() {
  setAnchors();
  const n = TOUCHES - touchesLeft + 1;
  touchInfo = mode === 'practice' ? t('practice') : mode === 'tutorial' && tut ? t('tut', { n: Math.min(TUT_N, tut.step + 1), m: TUT_N }) : t('touch', { who: t(turn === 0 ? 'you' : 'rival'), n, m: TOUCHES });
  if (turn === 0) {
    state = 'aim';
    if (!selected || selected.team !== 0) autoSelect();
    const hint = t(settings.shootHand === 'right' ? 'hint.r' : 'hint.l');
    say(touchesLeft > 1 ? hint : t('shootNow', { x: lastFlick || hint }));
  } else {
    // el rival juega rápido; mientras piensa puedes colocar tu defensa con la palma
    state = 'cpu'; timer = 0.35; cpuPrep = false; cpuGen = null; cpuShot = null;
    say(t(touchesLeft > 1 ? 'cpuPrep' : 'cpuShoot'));
  }
  drawBoard();
}

function fire(b, vx, vz, exact = false) {
  log.ev('fire', { team: b.team, cap: b.num, v: Math.hypot(vx, vz), vx, vz, loft: b.loft || 0, state });
  for (const holder of [...hands, ...pads, mouse]) holder.sling = null;
  if (!exact && b.team === 0 && !b.aimAssist) {
    const sp = Math.hypot(vx, vz), k = Math.min(1, sp / MAX_SHOT);
    const da = (Math.random() + Math.random() - 1) * 0.11 * k * k; // hasta ~6º a tope
    const c = Math.cos(da), sn = Math.sin(da);
    [vx, vz] = [vx * c - vz * sn, vx * sn + vz * c];
  }
  shoot(b, vx, vz);
  flickSound();
  if (b.team === 0) { tutEvent('shot'); tutEvent((b.loft || 0) > 0.25 ? 'shot_high' : 'shot_low'); }
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

function finishGame(won) {
  state = 'end';
  zoomTo(1);
  const news = recordResult(progress, { mode, won, diff: settings.difficulty, goalsFor: score[0], goalsAgainst: score[1] });
  touchInfo = t(mode === 'penalties' ? 'end.pens' : 'end.match');
  const names = news.map((u) => (u.kind === 'ball' ? ballName(u.key) : surfName(u.key)));
  say(names.length ? t('unlocked', { x: names.join(t('and')) }) : t(won ? 'won' : 'lost'));
  whistle('end');
  if (won) { celebrate(0, true); crowdSwell(1); }
  showStartButtons();
  drawBoard();
}
function afterGoalOrEnd() {
  if (score[0] >= GOALS_TO_WIN || score[1] >= GOALS_TO_WIN) {
    finishGame(score[0] > score[1]);
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
  if (state === 'aim' || state === 'cpu' || state === 'foul') {
    world.goalsOn = false;
    world.step(dt);
    world.goalsOn = true;
  }
  if (state === 'moving') {
    // cámara lenta: el balón va camino de una portería y está cerca
    const ball = world.ball;
    let want = 1;
    if (ball) {
      const lineZ = ball.vz < 0 ? -FIELD.L / 2 : FIELD.L / 2;
      const t = (lineZ - ball.z) / (ball.vz || 1e-9);
      const xAt = ball.x + ball.vx * t;
      const sp = Math.hypot(ball.vx, ball.vz);
      if (t > 0 && t < 0.35 && sp > 0.5 && Math.abs(xAt) < FIELD.goalW / 2 + 0.015) want = 0.3;
    }
    if (want < 1 && !slowFired) { slowFired = true; crowdSwell(0.6); }
    timeScale += (want - timeScale) * Math.min(1, dt * 8);
    dt *= timeScale;
    timer += dt;
    const ev = world.step(dt);
    rec.push(snapshot());
    if (rec.length > 900) rec.shift();
    for (const e of ev) {
      if (e.type === 'hit') hitSound(e.speed, e.a.kind === 'ball' || e.b.kind === 'ball' ? 'ball' : 'cap');
      else if (e.type === 'wall') { hitSound(e.speed, 'wall'); flashCushion(e.x, e.z, e.speed); }
      else if (e.type === 'net' || e.type === 'post') hitSound(e.speed * 0.4, 'net');
      else if (e.type === 'foul') {
        log.ev('foul', { team: e.team }); whistle('foul'); say(t('foul', { t: TEAMS[e.team].name })); }
      else if (e.type === 'bounce') hitSound(Math.abs(e.speed) * 2, 'ball');
    }
    if (world.goal) {
      const s = world.goal.scorer;
      score[s]++;
      log.ev('goal', { scorer: s, score: score.join('-'), mode });
      whistle('goal');
      goalSound();
      if (s === 0) playSample('gol-voz', 0.9); // tu "¡GOOOOL!" grabado (si existe)
      stadium.cheer(s);
      arena.cheer(s);
      celebrate(s);
      confetti.burst(s === 0 ? -FIELD.L / 2 : FIELD.L / 2, s);
      say(t(s === 0 ? 'goal.you' : 'goal.cpu'));
      touchInfo = t('scores', { t: TEAMS[s].name });
      recFps = (rec.length - 1) / Math.max(timer, 0.05);
      state = 'goal';
      timer = 2.6;
      drawBoard();
    } else if (world.settled() || timer > 10) {
      world.stopAll();
      for (const b of world.bodies) b.loft = 0;
      slowFired = false;
      if (freeKick) { freeKick = false; lockedCap = null; for (const b of world.bodies) { b.flipped = false; b.locked = false; } if (mode !== 'penalties') zoomTo(1); }
      if (mode === 'penalties') { penaltyResult(false); return; }
      if (mode === 'tutorial' || mode === 'practice') { touchesLeft = TOUCHES; nextTouch(); return; }
      if (world.foul !== null) {
        // falta: se acaba el turno y saca el rival
        state = 'foul';
        timer = 1.2;
        touchInfo = t('foulT');
        drawBoard();
      } else {
        touchesLeft--;
        if (touchesLeft > 0) nextTouch();
        else giveTurn(1 - lastShooter);
      }
    }
  } else if (state === 'penpause') {
    timer -= dt;
    if (timer <= 0) penaltyKick(pen.next);
  } else if (state === 'foul') {
    timer -= dt;
    if (timer <= 0) {
      const team = 1 - world.foul;
      if (inAttackArea(team, world.foulAt)) startPenalty(team);
      else startFreeKick(team);
    }
  } else if (state === 'goal') {
    timer -= dt;
    if (timer <= 0 && mode === 'penalties') { penaltyResult(true); return; }
    if (timer <= 0 && (mode === 'tutorial' || mode === 'practice')) { tutorialKickoff(); return; }
    if (timer <= 0) {
      state = 'replay';
      replayT = 0;
      touchInfo = '● ' + t('replay');
      say(t(world.goal.scorer === 0 ? 'replay.you' : 'replay.cpu'));
    }
  } else if (state === 'replay') {
    replayT += dt * 0.4; // cámara lenta
    const fi = Math.min(rec.length - 1, Math.floor(replayT * recFps));
    showFrame(rec[fi], dt * 0.4);
    const blink = (Math.floor(replayT * 5) % 2 === 0 ? '● ' : '○ ') + t('replay');
    if (blink !== touchInfo) { touchInfo = blink; drawBoard(); }
    if (fi >= rec.length - 1 && replayT > (rec.length - 1) / recFps + 0.5) { lastFrame = null; afterGoalOrEnd(); }
  } else if (state === 'cpu') {
    if (timer > 0) {
      timer -= dt;
      if (cpuPrep) {
        const c = t('defend', { n: Math.max(1, Math.ceil(timer)) });
        if (c !== touchInfo) { touchInfo = c; drawBoard(); }
        if (timer <= 0) { cpuPrep = false; touchInfo = t('touch', { who: t('rival'), n: TOUCHES - touchesLeft + 1, m: TOUCHES }); drawBoard(); for (const h of hands) releaseDrag(h); }
      }
      return;
    }
    if (!cpuGen) cpuGen = think(world, 1, { noise: DIFFICULTY[settings.difficulty].noise * (mode === 'penalties' ? 1.8 : 1) });
    if (!cpuShot) {
      const t0 = performance.now();
      while (performance.now() - t0 < 8) {
        const r = cpuGen.next();
        if (r.done) { cpuShot = r.value || { body: world.bodies.findIndex((b) => b.team === 1 && !b.kin), vx: 0, vz: 0.5 }; timer = 0.45; break; }
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
    if (b.kind !== 'ball' && !b.kin) m.rotation.y = -f[i * 4 + 2];
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
  const h = { hand, tipBall, hist: { 'index-finger-tip': [], 'middle-finger-tip': [] }, pinching: false, sling: null, cooldown: 0, side: null };
  hand.addEventListener('connected', (e) => { h.side = e.data?.handedness || null; });
  hand.addEventListener('disconnected', () => { h.side = null; });
  return h;
});
// Reparto de manos: una dispara (por defecto la derecha); la otra mueve chapas y elige.
// Si el visor no dice qué mano es, las dos hacen de todo.
const isShooter = (h) => !h.side || h.side === settings.shootHand;
const isMover = (h) => !h.side || h.side !== settings.shootHand;
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
function vyOf(hist) {
  if (hist.length < 3) return 0;
  const a = hist[hist.length - 3], b = hist[hist.length - 1];
  const dt = (b.t - a.t) / 1000;
  return dt > 0.005 ? (b.y - a.y) / dt : 0;
}
function velOf(hist, now) {
  // velocidad PUNTA de los últimos ~90 ms (entre muestras de 2 en 2 para quitar temblor)
  if (hist.length < 3) return null;
  let best = null, bs = 0;
  for (let i = 2; i < hist.length; i++) {
    const a = hist[i - 2], b = hist[i];
    if (now - b.t > 90) continue;
    const dt = (b.t - a.t) / 1000;
    if (dt < 0.008) continue;
    const vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt, sp = Math.hypot(vx, vz);
    if (sp > bs) { bs = sp; best = { vx, vz }; }
  }
  if (!best) return null;
  const old = hist[Math.max(0, hist.length - 4)];
  return { vx: best.vx, vz: best.vz, old };
}

function myCapNear(x, z, maxD) {
  let best = null, bd = maxD;
  for (const b of world.bodies) {
    if (b.team !== 0 || menuOpen || b.kin) continue;
    if (lockedCap && b !== lockedCap) continue;
    const d = Math.hypot(b.x - x, b.z - z) - b.r;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// Detección del toque. Mira el CAMINO del dedo entre dos lecturas (no solo dónde está),
// para que un toque rápido no se "salte" la chapa, y acepta una franja de altura amplia
// por si la mesa virtual no coincide al milímetro con la real.
function segDist(ax, az, bx, bz, px, pz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((px - ax) * ex + (pz - az) * ez) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + ex * t), pz - (az + ez * t));
}
// registro de toques rechazados (solo cuando el dedo está cerca de una chapa, para no llenarlo de ruido)
const rejectLog = {};
const hint = textPanel(0.14, 0.035, 2000);
hint.visible = false;
hint.material.depthTest = false; hint.renderOrder = 24;
root.add(hint);
let hintUntil = 0;
function showHint(key, x, z) {
  hint.userData.draw((g, w, h) => {
    g.fillStyle = 'rgba(10,14,20,0.85)'; g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
    g.fillStyle = '#ffd34d'; g.font = `bold ${Math.round(h * 0.55)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t(key), w / 2, h / 2 + 1);
  });
  hint.position.set(x, 0.06, z);
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const cp = cam.getWorldPosition(new THREE.Vector3()); hint.lookAt(cp);
  hint.visible = true;
  hintUntil = performance.now() + 1200;
}
function flickReject(why, data) {
  const now = performance.now();
  if (rejectLog[why] && now - rejectLog[why] < 250) return false;
  rejectLog[why] = now;
  log.ev('flick_no', { why, ...data });
  // el dedo estaba encima de la chapa: decirle por qué no ha contado
  const b = world.bodies.find((x) => x.num === data.cap && x.team === 0);
  const hk = { lento: 'hint.faster', vertical: 'hint.flat', hacia_atras: 'hint.forward', no_elegida_y_flojo: 'hint.faster', altura: 'hint.lower' }[why];
  if (b && hk && state === 'aim' && data.d < 0.008) showHint(hk, b.x, b.z);
  return false;
}
function tryFlick(p, vel, prev, capH = 0.06, vy = 0) {
  if (!vel) return false;
  const k = zoomScale();
  const s = Math.hypot(vel.vx, vel.vz) * k; // velocidad real del dedo (aunque la mesa esté acercada)
  const a = prev || p;
  let b = null, bd = Infinity;
  for (const c of world.bodies) {
    if (c.team !== 0 || menuOpen || c.kind === 'ball' || c.kin) continue;
    if (lockedCap && c !== lockedCap) continue;
    const d = segDist(a.x, a.z, p.x, p.z, c.x, c.z) - c.r;
    if (d < 0.016 && d < bd) { bd = d; b = c; }
  }
  if (!b) return false;
  const info = { cap: b.num, sel: selected?.num, sp: s, y: p.y, d: bd };
  if (p.y > capH || p.y < -0.05) return flickReject('altura', info);
  if (s < FLICK_MIN) return flickReject('lento', info);
  info.vy = vy * k;
  if (Math.abs(vy * k) > s * 0.8) return flickReject('vertical', info); // el dedo baja/sube: no es un toque
  if (freeKick && ((turn === 0 && vel.vz > 0) || (turn === 1 && vel.vz < 0))) return flickReject('hacia_atras', info);
  // la elegida sale con cualquier toque; otra chapa tuya, con un toque claro (y pasa a ser la elegida)
  if (b !== selected) {
    if (s < FLICK_MIN * 1.6) return flickReject('no_elegida_y_flojo', info);
    select(b, 'flick');
  }
  // el dedo tiene que ir hacia la chapa (no alejarse de ella)
  if ((b.x - vel.old.x) * vel.vx + (b.z - vel.old.z) * vel.vz <= 0) return flickReject('se_aleja', info);
  // dirección: mezcla de hacia dónde va el dedo y la línea dedo→centro de la chapa (por dónde golpea)
  const sl = Math.hypot(vel.vx, vel.vz) || 1;
  let dx = vel.vx / sl, dz = vel.vz / sl;
  const cx = b.x - p.x, cz = b.z - p.z, cl = Math.hypot(cx, cz);
  // en el penalti manda la dirección del dedo (con la guía de puntería); en juego se mezcla con el punto de golpeo
  if (cl > 1e-4 && !b.aimAssist) { dx = dx * 0.6 + (cx / cl) * 0.4; dz = dz * 0.6 + (cz / cl) * 0.4; }
  const dl = Math.hypot(dx, dz) || 1;
  const power = flickPower(s);
  log.ev('flick', { cap: b.num, sp: s, power, y: p.y, d: bd });
  fire(b, (dx / dl) * power, (dz / dl) * power);
  // medida visible para calibrar con el visor
  const fmt = (v) => (getLang() === 'es' ? v.toFixed(2).replace('.', ',') : v.toFixed(2));
  lastFlick = t('flick', { f: fmt(s), c: fmt(power) });
  touchInfo = lastFlick; drawBoard();
  return true;
}

function slingUpdate(holder, pinchOn, p) {
  // pellizcar SOBRE una chapa (al empezar el pellizco, no con la mano ya pellizcando por el camino),
  // estirar hacia atrás y soltar. El estirón es cuánto ha retrocedido la mano desde que pellizcaste.
  const pinchStarted = pinchOn && !holder.wasPinch;
  holder.wasPinch = pinchOn;
  if (!holder.sling && pinchStarted && p && p.y < 0.07) {
    const b = myCapNear(p.x, p.z, 0.022);
    if (b && (b === selected || holder === mouse || !selected)) {
      select(b, 'sling');
      holder.sling = { b, y0: p.y, x0: p.x, z0: p.z };
      log.ev('sling_start', { cap: b.num, d: Math.hypot(p.x - b.x, p.z - b.z) - b.r });
    }
  }
  if (holder.sling) {
    const b = holder.sling.b;
    if (p) {
      const k = zoomScale(); // con la mesa acercada, el mismo gesto real vale lo mismo
      const dx = holder.sling.x0 - p.x, dz = holder.sling.z0 - p.z;
      holder.sling.vx = dx * SLING_GAIN * k;
      holder.sling.vz = dz * SLING_GAIN * k;
      holder.sling.pull = Math.hypot(dx, dz) * k;
      // subir la mano mientras estiras = tiro por arriba (0 raso, 1 muy elevado)
      holder.sling.loft = Math.max(0, Math.min(1, (p.y - holder.sling.y0) / 0.07));
      showAim(b, holder.sling.vx, holder.sling.vz, holder.sling.loft);
    }
    if (!pinchOn) {
      const s = holder.sling;
      holder.sling = null;
      aim.visible = false;
      log.ev('sling_end', { cap: s.b.num, pull: s.pull || 0, loft: s.loft || 0, fired: (s.pull || 0) > 0.012 && state === 'aim' });
      if (s.pull > 0.012 && state === 'aim') { s.b.loft = s.loft || 0; fire(s.b, s.vx, s.vz); }
    }
  }
}

// Pilotos de luz encima de cada chapa disponible: se tocan con la punta del dedo para elegirla
const PILOT_Y = 0.045;
function pokePilots(p) {
  for (const b of world.bodies) {
    if (b.team !== 0 || b.kind === 'ball' || b.kin || b === selected || menuOpen) continue;
    if (lockedCap && b !== lockedCap) continue;
    if (Math.hypot(p.x - b.x, p.y - PILOT_Y, p.z - b.z) < 0.02) select(b, 'pilot');
  }
}

// Un toque = una pulsación: tras pulsar, ese dedo tiene que salir de todos los botones antes de
// volver a pulsar (antes, al redibujarse el menú, el dedo que seguía dentro pulsaba el botón nuevo
// una y otra vez: 'Mano de tiro' cambió 23 veces en 4 s). Además, 350 ms mínimo entre pulsaciones.
const btnLatch = new Map();
let lastBtnPress = 0;
function pokeButtons(p, now, who = 'x') {
  let inside = null;
  for (const btn of buttons) {
    if (!shown(btn)) continue;
    v3.copy(p);
    root.localToWorld(v3);
    btn.worldToLocal(v3);
    const { w, h } = btn.userData;
    const over = Math.abs(v3.x) < w / 2 && Math.abs(v3.y) < h / 2;
    if (over && v3.z < 0.05 && v3.z > -0.02) btn.userData.hoverT = now; // el dedo se acerca: el botón responde
    if (over && v3.z < 0.012 && v3.z > -0.02) { inside = btn; break; }
  }
  if (!inside) { btnLatch.delete(who); return; }
  if (btnLatch.get(who) || now - lastBtnPress < 350) return;
  btnLatch.set(who, true);
  lastBtnPress = now;
  initAudio();
  buttonSound();
  log.ev('button', { label: inside.userData.label });
  inside.userData.pressT = now;
  inside.userData.onPress();
}

// ---------- Panel flotante de instrucciones (calibración y tutorial), a la altura de los ojos ----------
const info = new THREE.Group();
info.visible = false;
scene.add(info);
const infoPanel = textPanel(0.46, 0.16, 1700);
info.add(infoPanel);
const skipBtn = makeButton(t('btn.skip'), 0.17, 0.055, '#b3263a');
skipBtn.position.set(0.14, -0.12, 0.002);
skipBtn.userData.onPress = () => skipInfo();
info.add(skipBtn);
buttons.push(skipBtn);
info.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 22; } });
function drawInfo(title, text, progressK = -1) {
  infoPanel.userData.draw((g, w, h) => {
    g.fillStyle = 'rgba(8,14,22,0.92)';
    g.beginPath(); g.roundRect(0, 0, w, h, 40); g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd34d'; g.font = `900 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    g.fillText(title, w / 2, h * 0.2);
    g.fillStyle = '#ffffff'; g.font = `600 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
    // dos líneas como mucho
    const words = text.split(' '); const lines = ['']; 
    for (const wd of words) { const t = (lines[lines.length - 1] + ' ' + wd).trim(); if (g.measureText(t).width > w * 0.9 && lines.length < 3) lines.push(wd); else lines[lines.length - 1] = t; }
    lines.forEach((l, i) => g.fillText(l, w / 2, h * (0.5 + i * 0.17)));
    if (progressK >= 0) {
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(w * 0.15, h * 0.86, w * 0.7, h * 0.05);
      g.fillStyle = '#7dffa1'; g.fillRect(w * 0.15, h * 0.86, w * 0.7 * Math.min(1, progressK), h * 0.05);
    }
  });
}
function placeFloating(obj, dist, dy) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const head = new THREE.Vector3(), dir = new THREE.Vector3();
  cam.getWorldPosition(head); cam.getWorldDirection(dir);
  if (renderer.xr.isPresenting) { dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); dir.normalize(); }
  obj.position.copy(head).addScaledVector(dir, dist);
  if (renderer.xr.isPresenting) obj.position.y = head.y + dy;
  obj.lookAt(head.x, renderer.xr.isPresenting ? obj.position.y : head.y, head.z);
}
function skipInfo() {
  if (state === 'calib') finishCalib(null);
  else if (mode === 'tutorial') endTutorial();
}

// ---------- Calibrar la mesa: apoya la palma abierta en tu mesa y déjala quieta un segundo ----------
const PALM_ABOVE_TABLE = 0.016; // a qué altura queda el centro de la palma sobre la mesa al apoyarla
const calibRing = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.045, 48, 1, 0, 0.01), new THREE.MeshBasicMaterial({ color: 0x7dffa1, side: THREE.DoubleSide, toneMapped: false, transparent: true, depthTest: false }));
calibRing.rotation.x = -Math.PI / 2; calibRing.visible = false; calibRing.renderOrder = 23;
scene.add(calibRing);
let calibK = 0;
function startCalib() {
  zoomTo(1); zoom.s = 1; zoom.cur.copy(zoom.anchor); applyTable(1);
  closeMenu();
  hideStartButtons();
  state = 'calib';
  calibK = 0;
  for (const h of hands) h.calHist = [];
  placeFloating(info, 0.6, 0.06);
  info.visible = true;
  drawInfo(t('calib.t'), t('calib.x'), 0);
}
function calibUpdate(dt) {
  let best = null;
  for (const h of hands) {
    const wrist = jointLocal(h.hand, 'wrist', new THREE.Vector3());
    const knuckle = jointLocal(h.hand, 'middle-finger-phalanx-proximal', new THREE.Vector3());
    const midTip = jointLocal(h.hand, 'middle-finger-tip', new THREE.Vector3());
    if (!wrist || !knuckle || !midTip || midTip.distanceTo(wrist) < 0.12) { h.calHist = []; continue; }
    const palmW = root.localToWorld(wrist.clone().add(knuckle).multiplyScalar(0.5));
    const now = performance.now();
    h.calHist.push({ t: now, p: palmW });
    while (h.calHist.length && now - h.calHist[0].t > 700) h.calHist.shift();
    const still = h.calHist.length > 5 && h.calHist.every((q) => q.p.distanceTo(palmW) < 0.012) && now - h.calHist[0].t > 600;
    if (still) best = palmW;
    calibRing.visible = true;
    calibRing.position.set(palmW.x, palmW.y - PALM_ABOVE_TABLE + 0.002, palmW.z);
  }
  calibK = best ? calibK + dt : Math.max(0, calibK - dt * 2);
  calibRing.geometry.dispose();
  calibRing.geometry = new THREE.RingGeometry(0.035, 0.045, 48, 1, 0, Math.max(0.01, Math.PI * 2 * Math.min(1, calibK)));
  drawInfo(t('calib.t'), t('calib.x'), calibK);
  if (calibK >= 1 && best) finishCalib(best.y - PALM_ABOVE_TABLE);
}
function finishCalib(tableY) {
  log.ev('calib', { tableY: tableY ?? -1, skipped: tableY === null });
  if (tableY !== null) { tableBase.pos.y = tableY; buttonSound(); celebrate(0); }
  calibRing.visible = false;
  info.visible = false;
  // tour de bienvenida cada vez que entras (se salta con SKIP)
  if (renderer.xr.isPresenting) startTutorial(true);
  else { state = 'menu'; showStartButtons(); say(t('pick')); }
}

// ---------- Tutorial jugable (60-90 s): no avanza hasta que haces cada gesto ----------
const ghost = createGhostHand();
root.add(ghost.group);
const TUT = [
  { key: 'tut1', side: 'left', pose: 'point', done: 'select' },
  { key: 'tut2', side: 'left', pose: 'flat', done: 'drag' },
  { key: 'tut3', side: 'right', pose: 'point', done: 'shot_low' },
  { key: 'tut5', side: 'right', pose: 'pinch', done: 'shot_high' },
  { key: 'tut4', side: 'right', pose: 'pinch', done: 'lever' },
  { key: 'tut6', side: 'right', pose: 'pinch', done: 'lever_fwd' },
];
const TUT_N = TUT.length;
let tut = null;
function startTutorial(welcome = false) {
  log.ev('tour', { welcome });
  mode = 'tutorial';
  hideStartButtons();
  closeMenu();
  setupMatch(world, 0, settings.ball);
  rebuildBodies();
  turn = 0; touchesLeft = TOUCHES;
  tut = { step: 0, t: 0, fin: 0 };
  placeFloating(info, 0.65, 0.12);
  info.visible = true;
  ghost.group.visible = true;
  tableSkip.visible = true;
  nextTouch();
  showTutStep();
  if (welcome) { tut.welcomeUntil = performance.now() + 3200; drawInfo(t('welcome.t'), t('welcome.x')); }
}
function showTutStep() {
  const st = TUT[tut.step];
  ghost.side(st.side); ghost.pose(st.pose);
  drawInfo(t(`${st.key}.t`), t(`${st.key}.x`));
  touchInfo = t('tut', { n: tut.step + 1, m: TUT_N });
  drawBoard();
}
function tutEvent(name) {
  if (mode !== 'tutorial' || !tut || tut.fin) return;
  if (TUT[tut.step].done !== name) return;
  buttonSound();
  confetti.burst(0, 0);
  log.ev('tut_step', { done: name, step: tut.step + 1 });
  tut.step++;
  if (tut.step >= TUT.length) {
    tut.fin = performance.now() + 3000;
    ghost.group.visible = false;
    drawInfo(t('tutDone.t'), t('tutDone.x'));
    progress.tutorialDone = true; saveProgress(progress);
    celebrate(0);
  } else showTutStep();
}
function tutorialKickoff() {
  setupMatch(world, 0, settings.ball);
  rebuildBodies();
  touchesLeft = TOUCHES;
  nextTouch();
}
function startPractice() {
  log.ev('start', { mode: 'practice' });
  closeMenu(); hideStartButtons();
  if (!renderer.xr.isPresenting) ui.style.display = 'none';
  mode = 'practice';
  zoomTo(1);
  setupMatch(world, 0, settings.ball);
  rebuildBodies();
  turn = 0; touchesLeft = TOUCHES;
  nextTouch();
  touchInfo = t('practice'); drawBoard();
}
function endTutorial() {
  tableSkip.visible = false;
  progress.tutorialDone = true; saveProgress(progress);
  tut = null;
  ghost.group.visible = false;
  info.visible = false;
  mode = 'match';
  state = 'menu';
  setupMatch(world, 0, settings.ball);
  rebuildBodies();
  showStartButtons();
  say(t('pick'));
  touchInfo = '';
  drawBoard();
}
function tutorialUpdate(dt) {
  if (mode !== 'tutorial' || !tut) return;
  tut.t += dt;
  if (tut.fin) { if (performance.now() > tut.fin) endTutorial(); return; }
  if (tut.welcomeUntil && performance.now() > tut.welcomeUntil) { tut.welcomeUntil = 0; showTutStep(); }
  const st = TUT[tut.step];
  const tt = tut.t;
  const g = ghost.group;
  g.rotation.set(0, 0, 0);
  if (st.done === 'select') {
    const c = world.bodies.find((b) => b.team === 0 && b.kind === 'cap' && b !== selected) || world.bodies.find((b) => b.team === 0 && b.kind === 'cap');
    g.rotation.x = -0.6; // mano inclinada, el índice apuntando a la chapa
    g.position.set(c.x, 0.06 + 0.025 * Math.abs(Math.sin(tt * 3)), c.z + 0.075);
  } else if (st.done === 'drag') {
    const c = selected || world.bodies.find((b) => b.team === 0 && b.kind === 'cap');
    g.position.set(c.x + Math.sin(tt * 2) * 0.03, 0.022, c.z + 0.025);
  } else if (st.done === 'shot_high') {
    // pellizca sobre la chapa, tira hacia atrás SUBIENDO la mano y suelta
    const c = selected || world.bodies.find((b) => b.team === 0 && b.kind === 'cap');
    const ph = (tt % 1.8) / 1.8, k = Math.min(1, ph / 0.7);
    g.position.set(c.x, 0.02 + k * 0.05, c.z + 0.01 + k * 0.08);
  } else if (st.done === 'lever_fwd') {
    const k = myKeeper();
    if (k) { const gp = gripPos(k); g.position.set(gp.x, gp.y + 0.02, gp.z + 0.02 - Math.abs(Math.sin(tt * 1.5)) * 0.06); }
  } else if (st.done === 'shot_low') {
    const c = selected || world.bodies.find((b) => b.team === 0 && b.kind === 'cap');
    const ph = (tt % 1.4) / 1.4;
    const k = ph < 0.55 ? 0 : ph < 0.68 ? (ph - 0.55) / 0.13 : 1;
    g.rotation.x = -0.3;
    g.position.set(c.x, 0.04, c.z + 0.15 - k * 0.06);
  } else if (st.done === 'lever') {
    const k = myKeeper();
    if (k) { const gp = gripPos(k); g.position.set(gp.x + Math.sin(tt * 2) * 0.04, gp.y + 0.02, gp.z + 0.02); }
  }
}

// ---------- Palanca del portero ----------
const myKeeper = () => world.bodies.find((b) => b.kin && b.team === 0);
function gripPos(k) { return new THREE.Vector3(k.x, 0.014, k.z + 0.155); }
// Agarre: se mide cuánto están doblados los dedos (como al coger un mango), no un puño perfecto.
function fingerCurl(hand) {
  let curled = 0, straight = 0;
  for (const f of ['index-finger', 'middle-finger', 'ring-finger']) {
    const tip = jointLocal(hand, `${f}-tip`, new THREE.Vector3());
    const base = jointLocal(hand, `${f}-metacarpal`, new THREE.Vector3());
    if (!tip || !base) continue;
    const d = tip.distanceTo(base);
    if (d < 0.068) curled++;
    if (d > 0.088) straight++;
  }
  return { curled, straight };
}
let leverHover = false;
function leverUpdate(h, grabbing, released, pts) {
  const k = myKeeper();
  if (!k || menuOpen) { h.lever = false; return false; }
  const g = gripPos(k);
  const dist = Math.min(...pts.filter(Boolean).map((p) => p.distanceTo(g)));
  if (dist < 0.08) leverHover = true;
  if (!h.lever && grabbing && dist < 0.06) {
    h.lever = true; buttonSound();
    log.ev('lever_grab', { d: dist, side: h.side });
    // el portero sigue el movimiento de la mano desde donde estaba (sin saltar hacia ella)
    const hp = pts.find(Boolean);
    h.leverOff = k.x - hp.x;
    h.leverOffZ = k.z - hp.z;
    h.leverX0 = k.x; h.leverZ0 = k.z;
  }
  // se suelta al abrir la mano (o si te alejas mucho): así no se cae a mitad de parada
  if (h.lever && (released || dist > 0.15)) { log.ev('lever_release', { why: released ? 'mano_abierta' : 'lejos', d: dist, kx: k.x, kz: k.z }); h.lever = false; applyKeeperMode(); }
  if (h.lever) {
    k.auto = false;
    const hp = pts.find(Boolean);
    k.tx = Math.max(-KEEPER.range, Math.min(KEEPER.range, hp.x + h.leverOff));
    k.tz = hp.z + h.leverOffZ; // hacia delante por el área (la física lo limita al área)
    if (Math.abs(k.x - h.leverX0) > 0.03) tutEvent('lever');
    if (Math.abs(k.z - h.leverZ0) > 0.03) tutEvent('lever_fwd');
  }
  return h.lever;
}

// ---------- Palma: arrastrar una chapa (con límite) y conducir el balón ----------
const limitRings = [0, 1].map(() => {
  const r = new THREE.Mesh(new THREE.RingGeometry(MOVE_LIMIT - 0.0012, MOVE_LIMIT, 48), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
  r.rotation.x = -Math.PI / 2; r.position.y = 0.0009; r.visible = false;
  root.add(r);
  return r;
});
function releaseDrag(h) {
  h.hover = null;
  if (h.drag) {
    const b = h.drag;
    b.drag = null;
    b.vx = 0; b.vz = 0;
    if (world.owner === b && world.ball) { world.ball.vx = 0; world.ball.vz = 0; } // el balón se queda pegado, no sale rodando
    // sin balón: puedes moverla todas las veces que quieras (cada arrastre, hasta MOVE_LIMIT desde donde quedó).
    // La que lleva el balón pegado mantiene el límite del turno (si no, se conduciría por todo el campo).
    if (world.owner !== b) { b.ax = b.x; b.az = b.z; }
    h.drag = null;
  }
}
function selectByTouch(tip) {
  if (tip.y > 0.04 || tip.y < -0.05) return;
  const t = myCapNear(tip.x, tip.z, 0.004);
  if (t && t !== selected && t.kind === 'cap') select(t, 'touch');
}
// La palma lleva la chapa como si estuviera pegada debajo: la chapa sigue a la mano (a velocidad suave),
// empuja lo que encuentra y, si tiene el balón, lo conduce. Se coge con la mano abierta a ras de mesa
// y se suelta levantando la mano o cerrándola.
function palmUpdate(h, i, open, closing, palm, dt) {
  // la palma arrastra tus chapas en cualquier momento del juego (también con el balón rodando)
  const active = palm && !menuOpen && ['aim', 'cpu', 'moving', 'foul', 'penpause'].includes(state);
  if (!active) { if (h.drag) log.ev('palm_release', { why: 'estado', state }); releaseDrag(h); limitRings[i].visible = false; return false; }
  if (h.drag && (palm.y > 0.1 || closing)) { log.ev('palm_release', { why: palm.y > 0.1 ? 'mano_alta' : 'mano_cerrada', y: palm.y }); releaseDrag(h); limitRings[i].visible = false; return false; }
  if (!h.drag) {
    h.hover = null;
    if (!open || palm.y > PALM_HEIGHT || palm.y < -0.06) { limitRings[i].visible = false; return false; }
    let best = null, bd = Infinity;
    for (const b of world.bodies) {
      if (b.team !== 0 || b.kin || b.kind === 'ball' || b === lockedCap) continue;
      if (hands.some((o) => o !== h && o.drag === b)) continue;
      const d = Math.hypot(palm.x - b.x, palm.z - b.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best || bd > best.r + 0.06) { limitRings[i].visible = false; return false; }
    if (bd > best.r + 0.035) { h.hover = best; limitRings[i].visible = false; return false; } // cerca: se marca en azul
    // ¡cogida! mantiene la distancia a la palma (no salta hacia la mano)
    h.drag = best;
    log.ev('palm_grab', { cap: best.num, d: bd, y: palm.y, side: h.side });
    h.off = { x: best.x - palm.x, z: best.z - palm.z };
    if (world.owner !== best) { best.ax = best.x; best.az = best.z; }
    best.drag = { tx: best.x, tz: best.z };
    h.grabAt = { x: best.x, z: best.z };
    buttonSound();
  }
  const b = h.drag;
  let tx = palm.x + h.off.x, tz = palm.z + h.off.z;
  const ox = tx - b.ax, oz = tz - b.az, ol = Math.hypot(ox, oz);
  if (ol > MOVE_LIMIT) { tx = b.ax + (ox / ol) * MOVE_LIMIT; tz = b.az + (oz / ol) * MOVE_LIMIT; if (!h.atLimit) log.ev('palm_limit', { cap: b.num }); h.atLimit = true; } else h.atLimit = false;
  tx = Math.max(-FIELD.W / 2 + b.r, Math.min(FIELD.W / 2 - b.r, tx));
  tz = Math.max(-FIELD.L / 2 + b.r, Math.min(FIELD.L / 2 - b.r, tz));
  b.drag.tx = tx; b.drag.tz = tz;
  if (h.grabAt && Math.hypot(b.x - h.grabAt.x, b.z - h.grabAt.z) > 0.02) tutEvent('drag');
  limitRings[i].visible = true;
  limitRings[i].position.set(b.ax, 0.0009, b.az);
  return true;
}

const shooterTips = [];
function updateXRInput(now, dt) {
  shooterTips.length = 0;
  for (const h of hands) h.dbg = null;
  if (log.enabled) queueMicrotask(() => log.sample(() => ({
    st: state, sel: selected?.num, ball: world.ball ? [world.ball.x, world.ball.z] : null, tableY: tableBase.pos.y, zoom: root.scale.x, kx: myKeeper()?.x,
    L: hands.find((h) => h.side === 'left')?.dbg || hands[0].dbg, R: hands.find((h) => h.side === 'right')?.dbg || hands[1].dbg,
  })));
  if (state === 'calib') {
    hands.forEach((h, hi) => { const tip = jointLocal(h.hand, 'index-finger-tip', v1); if (tip) pokeButtons(tip.clone(), now, 'h' + hi); });
    calibUpdate(dt);
    return;
  }
  hands.forEach((h, hi) => {
    h.tipBall.visible = false;
    const tip = jointLocal(h.hand, 'index-finger-tip', v1);
    if (!tip) { h.sling = null; h.lever = false; releaseDrag(h); limitRings[hi].visible = false; return; }
    const thumb = jointLocal(h.hand, 'thumb-tip', v2);
    const pd = thumb ? tip.distanceTo(thumb) : 1;
    if (!h.pinching && pd < PINCH_ON) h.pinching = true;
    else if (h.pinching && pd > PINCH_OFF) h.pinching = false;
    const pinchPt = thumb ? tip.clone().add(thumb).multiplyScalar(0.5) : tip.clone();
    const wrist = jointLocal(h.hand, 'wrist', new THREE.Vector3());
    const midTip = jointLocal(h.hand, 'middle-finger-tip', new THREE.Vector3());
    const knuckle = jointLocal(h.hand, 'middle-finger-phalanx-proximal', new THREE.Vector3());
    const palm = wrist && knuckle ? wrist.clone().add(knuckle).multiplyScalar(0.5) : null;
    const reach = wrist && midTip ? midTip.distanceTo(wrist) : 0;
    const fist = wrist && midTip && reach < 0.115 && tip.distanceTo(wrist) < 0.125;
    const open = !h.pinching && reach > 0.12 && pd > 0.045;
    const wideOpen = !h.pinching && reach > 0.14 && pd > 0.06;

    pokeButtons(tip, now, 'h' + hi);
    // la palanca tiene prioridad: si la tienes agarrada, esa mano no hace otra cosa
    const curl = fingerCurl(h.hand);
    {
      const iv = velOf(h.hist['index-finger-tip'], now);
      h.dbg = {
        side: h.side || '?', tip: [tip.x, tip.y, tip.z], palm: palm ? [palm.x, palm.y, palm.z] : null,
        pinch: pd, reach, curl: curl.curled, straight: curl.straight, open, fist: !!fist,
        vIdx: iv ? Math.hypot(iv.vx, iv.vz) : 0, drag: h.drag?.num, hover: h.hover?.num, lever: h.lever ? 1 : 0, sling: h.sling ? 1 : 0,
      };
    }
    // agarre de la palanca: con el pellizco (lo más fiable con seguimiento de manos), o el puño
    const grabbing = h.pinching || fist;
    const released = !h.pinching && !fist && (wideOpen || curl.straight >= 3 || pd > 0.05);
    const handCenter = jointLocal(h.hand, 'middle-finger-metacarpal', new THREE.Vector3());
    if (leverUpdate(h, grabbing, released, [handCenter, knuckle, palm, pinchPt])) { releaseDrag(h); limitRings[hi].visible = false; return; }
    // mano que mueve: palma para arrastrar, dedo para elegir (nunca dispara)
    if (isMover(h)) {
      if (palmUpdate(h, hi, open, h.pinching || curl.curled >= 2, palm, dt)) return;
      if (state === 'aim') { pokePilots(tip); selectByTouch(tip); }
    }
    if (!isShooter(h)) { pushHist(h.hist['index-finger-tip'], now, tip); return; }
    shooterTips.push(tip.clone());
    if (state === 'aim') slingUpdate(h, h.pinching, pinchPt);

    for (const name of ['index-finger-tip', 'middle-finger-tip']) {
      const p = name === 'index-finger-tip' ? tip.clone() : jointLocal(h.hand, name, new THREE.Vector3());
      if (!p) continue;
      pushHist(h.hist[name], now, p);
      if (state === 'aim' && !(h.sling && h.sling.pull > 0.012) && now > h.cooldown) {
        const hh = h.hist[name];
        const vel = velOf(hh, now);
        if (tryFlick(p, vel, hh.length > 1 ? hh[hh.length - 2] : null, 0.06, vyOf(hh))) h.cooldown = now + 400;
      }
    }
    // bolita en la punta del índice: se pone verde si vas lo bastante rápido
    const vel = velOf(h.hist['index-finger-tip'], now);
    const s = vel ? Math.hypot(vel.vx, vel.vz) : 0;
    h.tipBall.visible = true;
    h.tipBall.position.copy(root.localToWorld(tip.clone()));
    h.tipBall.material.color.set(s > FLICK_MIN ? 0x5dff8a : 0xffffff);
  });
  for (const pd of pads) {
    if (!pd.connected || pd.isHand) continue;
    pd.grip.getWorldPosition(v1);
    const p = root.worldToLocal(v1).clone();
    pokeButtons(p, now, 'pad' + pads.indexOf(pd));
    pushHist(pd.hist, now, p);
    if (state === 'aim') {
      slingUpdate(pd, pd.pressing, p);
      if (!pd.pressing && !pd.sling) tryFlick(p, velOf(pd.hist, now), pd.hist.length > 1 ? pd.hist[pd.hist.length - 2] : null, 0.07);
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
  {
    const pt = pointerTable(e), k = myKeeper();
    if (pt && k && pt.distanceTo(gripPos(k)) < 0.04) { mouse.lever = true; return; }
  }
  if (state === 'aim') {
    const pt = pointerTable(e);
    const b = pt && myCapNear(pt.x, pt.z, 0.006);
    // con el ratón: primer clic elige la chapa, el siguiente arrastra para tirar
    if (b && b !== selected) { select(b); mouse.down = false; return; }
    if (b === selected) { mouse.wasPinch = false; slingUpdate(mouse, true, pt); }
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  mouse.tip = pointerTable(e);
  if (mouse.lever) { const pt = pointerTable(e), k = myKeeper(); if (pt && k) { k.tx = Math.max(-KEEPER.range, Math.min(KEEPER.range, pt.x)); k.tz = pt.z - 0.155; if (Math.abs(k.tx) > 0.03) tutEvent('lever'); if (k.homeZ - k.tz > 0.03) tutEvent('lever_fwd'); } return; }
  if (mouse.down && state === 'aim') slingUpdate(mouse, true, pointerTable(e));
});
addEventListener('keydown', (e) => {
  const k = myKeeper();
  if (!k) return;
  if (e.key === 'ArrowLeft') k.tx = Math.max(-KEEPER.range, (k.tx ?? k.x) - 0.012);
  if (e.key === 'ArrowRight') k.tx = Math.min(KEEPER.range, (k.tx ?? k.x) + 0.012);
  if (e.key === 'ArrowUp') k.tz = (k.tz ?? k.z) - 0.012;
  if (e.key === 'ArrowDown') k.tz = Math.min(k.homeZ, (k.tz ?? k.z) + 0.012);
});
addEventListener('pointerup', (e) => {
  mouse.down = false;
  mouse.lever = false;
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
  tableBase.pos.copy(v1).addScaledVector(v2, 0.75);
  tableBase.pos.y = Math.max(0.45, v1.y - 0.5);
  tableBase.rotY = Math.atan2(-v2.x, -v2.z);
}

// ---------- Botones de entrada al visor ----------
const ui = document.getElementById('ui');
function applyHtmlLang() {
  document.documentElement.lang = getLang();
  document.getElementById('intro').textContent = t('html.intro');
  document.getElementById('help').innerHTML = t('html.help');
  document.getElementById('langbtn').textContent = t('html.lang');
  for (const b of document.querySelectorAll('#xrbuttons button')) b.textContent = t(b.dataset.key);
}
document.getElementById('langbtn').onclick = () => setLang(getLang() === 'en' ? 'es' : 'en');
// al cambiar de idioma, se redibuja todo lo que tiene texto
onLang(() => {
  applyHtmlLang();
  relabelTable();
  { const nb = makeButton(t('btn.skip'), 0.17, 0.055, '#b3263a'); skipBtn.remove(skipBtn.userData.panel); nb.userData.panel.material.depthTest = false; nb.userData.panel.renderOrder = 22; skipBtn.add(nb.userData.panel); skipBtn.userData.panel = nb.userData.panel; }
  if (menuOpen) showPage(menuPage);
  if (mode === 'tutorial' && tut && !tut.fin) showTutStep();
  if (state === 'calib') drawInfo(t('calib.t'), t('calib.x'), calibK);
  if (state === 'menu') say(t('pick'));
  drawBoard();
});
let xrMode = null;
async function setupXRButtons() {
  applyHtmlLang();
  if (!navigator.xr) { document.getElementById('xrinfo').textContent = t('html.noxr'); return; }
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  const box = document.getElementById('xrbuttons');
  if (ar) box.appendChild(xrButton('html.ar', 'immersive-ar'));
  if (vr) box.appendChild(xrButton(ar ? 'html.vr' : 'html.vronly', 'immersive-vr', !!ar));
  if (!ar && !vr) document.getElementById('xrinfo').textContent = t('html.nodevice');
}
function xrButton(key, mode, secondary) {
  const b = document.createElement('button');
  b.dataset.key = key;
  b.textContent = t(key);
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
      document.getElementById('xrinfo').textContent = t('html.err') + err.message;
    }
  };
  return b;
}
function onXRStart() {
  log.ev('xr_start', { mode: xrMode });
  ui.style.display = 'none';
  crowdOn();
  crowdVolume(settings.crowd ? 1 : 0);
  const passthrough = xrMode === 'immersive-ar';
  scene.background = passthrough ? null : bgColor;
  room.visible = !passthrough;
  tableLegs.visible = !passthrough;
  applySky();
  placeRequested = true;
  calibPending = true; // en cuanto la mesa esté delante, pedimos apoyar la palma
}
let calibPending = false;
function onXREnd() {
  log.ev('xr_end');
  log.flush();
  ui.style.display = '';
  toggleMusic(false);
  crowdVolume(0);
  scene.background = bgColor;
  room.visible = true;
  tableLegs.visible = true;
  applySky();
  tableBase.pos.set(0, 0.8, 0);
  tableBase.rotY = 0;
  zoomTo(1);
}

// ---------- Bucle ----------
let lastT = 0;
renderer.setAnimationLoop((t) => {
  const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0);
  lastT = t;
  const now = performance.now();
  if (renderer.xr.isPresenting) {
    if (placeRequested) { placeInFront(); placeRequested = false; }
    applyTable(dt);
    if (calibPending) { calibPending = false; startCalib(); }
    leverHover = false;
    updateXRInput(now, dt);
    updateGuide(shooterTips);
  }
  if (!renderer.xr.isPresenting) { applyTable(dt); updateGuide(mouse.tip ? [mouse.tip] : []); }
  updateGame(dt);
  tutorialUpdate(dt);
  if (state !== loggedState) { log.ev('state', { from: loggedState, to: state, mode, turn, touches: touchesLeft }); loggedState = state; }
  updateLogHud(t);
  // botones vivos: crecen al acercar el dedo y se hunden al pulsar
  for (const b of buttons) {
    const ud = b.userData;
    const target = now - (ud.pressT || 0) < 140 ? 0.9 : now - (ud.hoverT || 0) < 120 ? 1.08 : 1;
    const sc = b.scale.x + (target - b.scale.x) * 0.35;
    b.scale.setScalar(sc);
  }
  if (hint.visible && performance.now() > hintUntil) hint.visible = false;
  if (state !== 'replay') syncMeshes(dt);
  confetti.update(dt);
  tableFireworks.update(dt);
  if (room.visible) arenaFireworks.update(dt);
  updateCushions(dt);
  // la empuñadura se ilumina: blanca si tu mano está cerca, amarilla si la tienes agarrada
  {
    const k = myKeeper();
    const grip = k && meshes[world.bodies.indexOf(k)]?.userData.grip;
    if (grip) {
      const held = hands.some((h) => h.lever) || mouse.lever;
      grip.material.emissive.set(held ? 0xffc23d : 0xffffff);
      grip.material.emissiveIntensity = held ? 0.9 : leverHover ? 0.35 : 0;
    }
  }
  if (state !== 'replay') effects.update(dt, world.bodies);
  if (stadium.group.visible) stadium.update(dt, t / 1000);
  if (room.visible) arena.update(dt, t / 1000);
  // aros de "te toca"
  const pulse = 0.35 + 0.25 * Math.sin(t / 250);
  world.bodies.forEach((b, i) => {
    const ud = meshes[i]?.userData;
    if (!ud) return;
    const mine = state === 'aim' && b.team === 0 && (!lockedCap || b === lockedCap);
    const palmOn = hands.some((h) => h.drag === b || h.hover === b);
    if (ud.glow) {
      ud.glow.material.opacity = palmOn ? 0.95 : mine ? (b === selected ? 0.95 : pulse * 0.6) : 0;
      ud.glow.material.color.set(palmOn ? 0x6ec8ff : b === selected ? 0xffe066 : 0x8fffb0);
    }
    if (ud.reach) ud.reach.material.opacity = mine ? (b === selected ? 0.55 : 0.18) : (world.owner === b ? 0.35 : 0);
    if (ud.pilot) {
      ud.pilot.group.visible = mine && !b.flipped;
      const sel = b === selected;
      const col = sel ? 0xffd34d : 0x8fffb0;
      ud.pilot.bulb.material.color.set(col); ud.pilot.halo.material.color.set(col);
      const k = sel ? 1.25 : 0.85 + 0.15 * Math.sin(t / 200 + i);
      ud.pilot.bulb.scale.setScalar(k); ud.pilot.halo.scale.setScalar(k * (sel ? 1.2 : 1));
      ud.pilot.halo.material.opacity = sel ? 0.4 : 0.2;
      // el piloto no gira ni se inclina con la chapa
      ud.pilot.group.rotation.set(-meshes[i].rotation.x, b.angle, -meshes[i].rotation.z, 'YXZ');
    }
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
setSurface(settings.surface);
rebuildBodies();
say(t('pick'));
drawBoard();
setupXRButtons();

// Para pruebas automáticas
window.__campioni = { root, renderer, camera, applySky,
  tipWorld: (i) => { const j = hands[i].hand.joints?.['index-finger-tip']; if (!j || !j.visible) return null; const v = new THREE.Vector3(); j.getWorldPosition(v); return v.toArray(); },
  toWorld: (x, y, z) => root.localToWorld(new THREE.Vector3(x, y, z)).toArray(),
  world, get state() { return state; }, get touchesLeft() { return touchesLeft; }, get score() { return score; }, get freeKick() { return freeKick; }, get selected() { return selected; }, setSurface, showPage, startPenalties, get mode() { return mode; }, log, startTutorial, tutEvent, get tut() { return tut; }, startCalib, get pen() { return pen; }, progress, myKeeper, get cpuPrep() { return cpuPrep; }, select, startPenalty, startMatch, startFreeKick, openMenu, setBall, settings, fire: (i, vx, vz) => fire(world.bodies[i], vx, vz) };
