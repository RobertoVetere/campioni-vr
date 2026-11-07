// Mallas: tapete, bandas, porterías, chapas con camiseta, porteros de tapón con celo, garbanzo.
import * as THREE from 'three';
import { FIELD } from './physics.js';

export const TEAMS = [
  { name: 'AZZURRI', shirt: '#1f5fd1', stripe: '#1f5fd1', num: '#ffffff', keeper: '#f2c400' },
  { name: 'ROSSONERI', shirt: '#c8102e', stripe: '#111111', num: '#ffffff', keeper: '#22a35a' },
];

const CAP_H = 0.0065;
const KEEPER_H = 0.024;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function fieldTexture() {
  const { L, W, goalW } = FIELD;
  const px = 1400; // px por metro
  return canvasTex(Math.round(W * px), Math.round(L * px), (g, w, h) => {
    // tapete con franjas de césped
    for (let i = 0; i < 10; i++) {
      g.fillStyle = i % 2 ? '#2f8a3e' : '#2a7f38';
      g.fillRect(0, (i * h) / 10, w, h / 10 + 1);
    }
    // grano de fieltro
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 0.004 * px;
    const m = 0.012 * px;
    g.strokeRect(m, m, w - 2 * m, h - 2 * m);
    g.beginPath(); g.moveTo(m, h / 2); g.lineTo(w - m, h / 2); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 0.075 * px, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(w / 2, h / 2, 0.005 * px, 0, Math.PI * 2); g.fill();
    for (const top of [true, false]) {
      const aw = (goalW + 0.14) * px, ah = 0.12 * px;
      const sw = (goalW + 0.04) * px, sh = 0.05 * px;
      const y0 = top ? m : h - m;
      const dir = top ? 1 : -1;
      g.strokeRect(w / 2 - aw / 2, top ? y0 : y0 - ah, aw, ah);
      g.strokeRect(w / 2 - sw / 2, top ? y0 : y0 - sh, sw, sh);
      g.beginPath(); g.arc(w / 2, y0 + dir * 0.09 * px, 0.004 * px, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(w / 2, y0 + dir * ah, 0.04 * px, top ? 0.15 * Math.PI : 1.15 * Math.PI, top ? 0.85 * Math.PI : 1.85 * Math.PI); g.stroke();
    }
  });
}

export function buildTable() {
  const { L, W, goalW, goalD } = FIELD;
  const g = new THREE.Group();
  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(W, L),
    new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.95 })
  );
  felt.rotation.x = -Math.PI / 2;
  g.add(felt);
  // tablero de madera debajo
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.7 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.018, L + 0.06 + goalD * 2), wood);
  board.position.y = -0.0095;
  g.add(board);
  // bandas
  const rail = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.6 });
  const rh = 0.016, rt = 0.012;
  const addBox = (w, d, x, z, mat = rail, h = rh) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    g.add(m);
    return m;
  };
  addBox(rt, L + rt * 2, -W / 2 - rt / 2, 0);
  addBox(rt, L + rt * 2, W / 2 + rt / 2, 0);
  const sideW = (W - goalW) / 2;
  // Capa de goma en todo el borde del estadio: es lo que hace rebotar.
  // Se ilumina un instante cuando algo choca (userData.cushions).
  const cushions = [];
  const ct = 0.006, ch = 0.011;
  const addCushion = (x1, z1, x2, z2) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2a516, roughness: 0.45, emissive: 0xffd36b, emissiveIntensity: 0 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 === x2 ? ct : len, ch, x1 === x2 ? len : ct), mat);
    // un poco hacia fuera del campo para que la cara de la goma coincida con la línea de choque
    const ox = x1 === x2 ? Math.sign(x1) * ct / 2 : 0;
    const oz = z1 === z2 ? Math.sign(z1) * ct / 2 : 0;
    m.position.set((x1 + x2) / 2 + ox, ch / 2, (z1 + z2) / 2 + oz);
    g.add(m);
    cushions.push({ mesh: m, x1, z1, x2, z2, flash: 0, base: m.scale.clone() });
  };
  addCushion(-W / 2, -L / 2, -W / 2, L / 2);
  addCushion(W / 2, -L / 2, W / 2, L / 2);
  for (const s of [1, -1]) {
    addCushion(-W / 2, s * L / 2, -goalW / 2, s * L / 2);
    addCushion(goalW / 2, s * L / 2, W / 2, s * L / 2);
  }
  g.userData.cushions = cushions;
  for (const s of [1, -1]) {
    addBox(sideW + rt, rt, -(goalW / 2 + sideW / 2) - rt / 2, s * (L / 2 + rt / 2));
    addBox(sideW + rt, rt, goalW / 2 + sideW / 2 + rt / 2, s * (L / 2 + rt / 2));
    // portería: postes, larguero y red
    const post = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const ph = 0.035, pr = 0.0018;
    for (const x of [-goalW / 2, goalW / 2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, ph, 10), post);
      p.position.set(x, ph / 2, s * L / 2);
      g.add(p);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, goalW, 10), post);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, ph, s * L / 2);
    g.add(bar);
    const net = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(goalW, ph, goalD, 12, 3, 4), net);
    box.position.set(0, ph / 2, s * (L / 2 + goalD / 2));
    g.add(box);
    // fondo de la red con algo de cuerpo para que la física se vea coherente
    addBox(goalW + 0.004, 0.003, 0, s * (L / 2 + goalD), new THREE.MeshStandardMaterial({ color: 0xdddddd }), 0.01);
    addBox(0.003, goalD, -goalW / 2, s * (L / 2 + goalD / 2), new THREE.MeshStandardMaterial({ color: 0xdddddd }), 0.006);
    addBox(0.003, goalD, goalW / 2, s * (L / 2 + goalD / 2), new THREE.MeshStandardMaterial({ color: 0xdddddd }), 0.006);
  }
  return g;
}

function shirtTexture(team, num, keeper) {
  const T = TEAMS[team];
  return canvasTex(256, 256, (g, w, h) => {
    // fondo: el interior de la chapa (corcho/plástico)
    g.fillStyle = '#e9e4d6';
    g.fillRect(0, 0, w, h);
    // camiseta recortada
    g.save();
    g.translate(w / 2, h / 2 + 6);
    g.beginPath();
    g.moveTo(-34, -78); g.lineTo(-92, -50); g.lineTo(-74, -6); g.lineTo(-52, -18);
    g.lineTo(-52, 80); g.lineTo(52, 80); g.lineTo(52, -18); g.lineTo(74, -6);
    g.lineTo(92, -50); g.lineTo(34, -78);
    g.quadraticCurveTo(0, -50, -34, -78);
    g.closePath();
    g.clip();
    g.fillStyle = keeper ? T.keeper : T.shirt;
    g.fillRect(-120, -120, 240, 240);
    if (!keeper && T.stripe !== T.shirt) {
      g.fillStyle = T.stripe;
      for (let x = -100; x < 100; x += 40) g.fillRect(x, -120, 20, 240);
    }
    g.restore();
    g.fillStyle = T.num;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 5;
    g.font = 'bold 92px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.strokeText(String(num), w / 2, h / 2 + 18);
    g.fillText(String(num), w / 2, h / 2 + 18);
  });
}

function crimpedSide(r, h, teeth = 21) {
  const geo = new THREE.CylinderGeometry(r, r * 1.04, h, teeth * 2, 1, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.07 * Math.cos(a * teeth);
    pos.setX(i, x * k); pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const metal = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.9, roughness: 0.3 });

export function buildCap(body) {
  const g = new THREE.Group();
  const r = body.r;
  if (body.kind === 'keeper') {
    // dos tapones grandes apilados, envueltos en celo
    const tape = new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.92 });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r, KEEPER_H, 32), tape);
    side.position.y = KEEPER_H / 2;
    g.add(side);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.0012, 6, 32), new THREE.MeshStandardMaterial({ color: TEAMS[body.team].keeper }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = KEEPER_H / 2;
    g.add(ring);
    const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 32), new THREE.MeshStandardMaterial({ map: shirtTexture(body.team, body.num, true), roughness: 0.5 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = KEEPER_H + 0.0002;
    g.add(top);
    g.userData.h = KEEPER_H;
  } else {
    const side = new THREE.Mesh(crimpedSide(r, CAP_H), metal);
    side.position.y = CAP_H / 2;
    g.add(side);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, 0.0009, 6, 32), metal);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = CAP_H;
    g.add(rim);
    const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 32), new THREE.MeshStandardMaterial({ map: shirtTexture(body.team, body.num, false), roughness: 0.6 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = CAP_H + 0.0001;
    g.add(top);
    g.userData.h = CAP_H;
  }
  // aro de "te toca" (se enciende en tu turno)
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(r * 1.15, r * 1.45, 32),
    new THREE.MeshBasicMaterial({ color: 0x8fffb0, transparent: true, opacity: 0, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.0006;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

export function buildBall(body) {
  const geo = new THREE.SphereGeometry(body.r, 18, 14);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // garbanzo: algo irregular y con "pico"
    let k = 1 + 0.06 * Math.sin(x * 900) * Math.cos(z * 700) + 0.04 * Math.sin(y * 1300);
    if (x > body.r * 0.6 && y > 0) k += 0.18 * (x / body.r - 0.6);
    pos.setXYZ(i, x * k, y * k * 0.95, z * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8b072, roughness: 0.75 }));
  m.position.y = body.r;
  const g = new THREE.Group();
  g.add(m);
  g.userData.ball = m;
  return g;
}

let shadowTex = null;
export function buildShadow(r) {
  if (!shadowTex) {
    shadowTex = canvasTex(64, 64, (g, w) => {
      const grd = g.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, 0, w, w);
    });
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 3, r * 3),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0004;
  return m;
}

// Panel de texto que se puede reescribir
export function textPanel(w, h, pxPerM = 1600) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * pxPerM); c.height = Math.round(h * pxPerM);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.userData.draw = (fn) => { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); fn(g, c.width, c.height); tex.needsUpdate = true; };
  return mesh;
}

// Botón 3D que se pulsa con la punta del dedo
export function makeButton(label, w = 0.07, h = 0.035, color = '#1f5fd1') {
  const g = new THREE.Group();
  const panel = textPanel(w, h, 2400);
  panel.userData.draw((ctx, cw, ch) => {
    ctx.fillStyle = color;
    const r = ch * 0.3;
    ctx.beginPath();
    ctx.roundRect(4, 4, cw - 8, ch - 8, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(ch * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cw / 2, ch / 2 + 2);
  });
  g.add(panel);
  g.userData = { w, h, label, panel, pressed: 0 };
  return g;
}
