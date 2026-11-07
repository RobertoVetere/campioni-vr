// Estadio en miniatura alrededor del campo, en low poly facetado:
// gradas por los cuatro lados (la tuya, baja y solo detrás de la portería, para poder meter la mano),
// techos, público animado que salta con los goles, focos, banderas y vallas LED con texto en movimiento.
import * as THREE from 'three';
import { FIELD } from './physics.js';
import { TEAMS } from './visuals.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

function ledTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#05070a'; g.fillRect(0, 0, c.width, c.height);
  const ads = [['★ CAMPIONI ★', '#ffd34d'], ['GARBANZO FC', '#7dffa1'], ['CHAPAS DE ORO', '#ffffff'], ['TAPÓN & CELO', '#6ea2ff'], ['¡FORZA!', '#ff6b7d']];
  g.font = '900 44px system-ui, sans-serif'; g.textBaseline = 'middle';
  let x = 20;
  while (x < c.width) {
    for (const [t, col] of ads) {
      g.fillStyle = col; g.fillText(t, x, 34);
      x += g.measureText(t).width + 60;
      if (x > c.width) break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; // sin rejilla de píxeles: con ella las vallas parpadeaban al moverse
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildStadium() {
  const { L, W, goalD } = FIELD;
  const g = new THREE.Group();
  const people = []; // {x,y,z,ry,team,phase}
  const tierD = 0.028, tierH = 0.016, seatGap = 0.0125;
  const concrete = flat(0x9aa3ad), seatA = flat(0x2c4f9e), seatB = flat(0x9e2c3c), roofMat = flat(0xc3ccd6, { side: THREE.DoubleSide });
  const steel = flat(0x5b6570);

  // Grada recta. (cx,cz) = punto del borde del campo; dir apunta HACIA FUERA.
  function stand(cx, cz, length, along, dirX, dirZ, tiers, teamFn, roof, start = 0.035) {
    for (let t = 0; t < tiers; t++) {
      const h = tierH * (t + 1);
      const off = start + tierD * t + tierD / 2;
      const geo = along === 'z' ? new THREE.BoxGeometry(tierD, h, length) : new THREE.BoxGeometry(length, h, tierD);
      const m = new THREE.Mesh(geo, t % 2 ? concrete : (t / 2) % 2 ? seatB : seatA);
      m.position.set(cx + dirX * off, h / 2, cz + dirZ * off);
      g.add(m);
      const n = Math.floor(length / seatGap);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.1) continue; // algún asiento vacío
        const s = -length / 2 + (i + 0.5) * seatGap + (Math.random() - 0.5) * 0.003;
        const px = along === 'z' ? m.position.x : cx + s;
        const pz = along === 'z' ? cz + s : m.position.z;
        people.push({ x: px, y: h, z: pz, ry: Math.atan2(-dirX, -dirZ), team: teamFn(px, pz), phase: Math.random() * 6.28 });
      }
    }
    // pared trasera
    const backOff = start + tierD * tiers + 0.002;
    const bh = tierH * tiers + 0.02;
    const wallGeo = along === 'z' ? new THREE.BoxGeometry(0.004, bh, length) : new THREE.BoxGeometry(length, bh, 0.004);
    const wall = new THREE.Mesh(wallGeo, concrete);
    wall.position.set(cx + dirX * backOff, bh / 2, cz + dirZ * backOff);
    g.add(wall);
    if (roof) {
      // techo voladizo inclinado sobre las filas de atrás
      const depth = tierD * tiers * 0.42;
      const rg = along === 'z' ? new THREE.BoxGeometry(depth, 0.003, length * 1.02) : new THREE.BoxGeometry(length * 1.02, 0.003, depth);
      const r = new THREE.Mesh(rg, roofMat);
      const ro = backOff - depth / 2;
      r.position.set(cx + dirX * ro, bh + 0.035, cz + dirZ * ro);
      if (along === 'z') r.rotation.z = dirX * 0.12; else r.rotation.x = -dirZ * 0.12;
      g.add(r);
      for (let i = 0; i <= 4; i++) {
        const s = -length / 2 + (i / 4) * length;
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.035 + 0.004, 0.003), steel);
        p.position.set(along === 'z' ? cx + dirX * backOff : cx + s, bh + 0.0175, along === 'z' ? cz + s : cz + dirZ * backOff);
        g.add(p);
      }
    }
  }
  const mixed = () => (Math.random() < 0.5 ? 0 : 1);
  stand(-W / 2, 0, L * 0.95, 'z', -1, 0, 3, mixed, true);
  stand(W / 2, 0, L * 0.95, 'z', 1, 0, 3, mixed, true);
  // fondo lejano: la grada del rival, la más alta
  stand(0, -L / 2 - goalD, W * 0.98, 'x', 0, -1, 4, () => (Math.random() < 0.85 ? 1 : 0), true, 0.03);
  // tu fondo: baja y estrecha, detrás de tu portería (los tuyos)
  stand(0, L / 2 + goalD, W * 0.42, 'x', 0, 1, 1, () => (Math.random() < 0.9 ? 0 : 1), false, 0.03);

  // Público: dos InstancedMesh (cuerpo + cabeza) con colores de equipo
  const bodyGeo = new THREE.BoxGeometry(0.0075, 0.011, 0.005);
  bodyGeo.translate(0, 0.0055, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.0034, 0);
  headGeo.translate(0, 0.0145, 0);
  const bodies = new THREE.InstancedMesh(bodyGeo, flat(0xffffff), people.length);
  const heads = new THREE.InstancedMesh(headGeo, flat(0xffffff), people.length);
  const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map((c) => new THREE.Color(c));
  const shirts = TEAMS.map((t) => [new THREE.Color(t.shirt), new THREE.Color(t.stripe === t.shirt ? '#ffffff' : t.stripe)]);
  people.forEach((p, i) => {
    bodies.setColorAt(i, shirts[p.team][Math.random() < 0.75 ? 0 : 1]);
    heads.setColorAt(i, skins[i % skins.length]);
  });
  g.add(bodies, heads);

  // Vallas LED a ras de campo con texto que se desplaza
  const led = ledTexture();
  const ledMat = new THREE.MeshBasicMaterial({ map: led });
  const ledH = 0.014;
  const addLed = (len, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, ledH), ledMat);
    m.position.set(x, 0.0175 + ledH / 2, z);
    m.rotation.y = ry;
    g.add(m);
  };
  led.repeat.set(1.2, 1);
  addLed(L * 0.9, -W / 2 - 0.024, 0, Math.PI / 2);
  addLed(L * 0.9, W / 2 + 0.024, 0, -Math.PI / 2);
  addLed(W * 0.9, 0, -L / 2 - goalD - 0.018, 0);

  // Focos en las cuatro esquinas
  const lamp = flat(0xfff6d5, { emissive: 0xfff2b0, emissiveIntensity: 1.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 + 0.13), z = sz * (L / 2 + 0.08);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.24, 6), steel);
    p.position.set(x, 0.12, z);
    g.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.006), lamp);
    head.position.set(x, 0.245, z);
    head.lookAt(0, 0, 0);
    g.add(head);
  }

  // Banderas en lo alto de la grada lejana
  const flags = [];
  const farBack = -L / 2 - goalD - 0.03 - tierD * 4;
  for (const [i, x] of [-W * 0.35, 0, W * 0.35].entries()) {
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.07, 5), steel);
    fp.position.set(x, tierH * 4 + 0.055 + 0.035, farBack);
    g.add(fp);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.018, 4, 1), flat(TEAMS[i === 1 ? 1 : 0].shirt, { side: THREE.DoubleSide }));
    flag.position.set(x + 0.015, fp.position.y + 0.025, farBack);
    flag.geometry.translate(0.015, 0, 0);
    flag.position.x = x;
    g.add(flag);
    flags.push(flag);
  }

  // Animación
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let cheer = [0, 0];
  function update(dt, t) {
    cheer = cheer.map((v) => Math.max(0, v - dt));
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const c = cheer[p.team];
      const jump = c > 0 ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.012 : Math.max(0, Math.sin(t * 1.3 + p.phase)) * 0.0008;
      pos.set(p.x, p.y + jump, p.z);
      q.setFromAxisAngle(up, p.ry + (c > 0 ? Math.sin(t * 6 + p.phase) * 0.3 : 0));
      m4.compose(pos, q, one);
      bodies.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 2.2 + i) * 0.4; });
    led.offset.x = (t * 0.025) % 1;
  }
  update(0, 0);
  return { group: g, update, cheer: (team) => { cheer[team] = 3; }, count: people.length };
}
