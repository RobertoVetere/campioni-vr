// Estadio en miniatura alrededor del campo, en low poly facetado:
// gradas escalonadas, público animado (salta con los goles), focos, banderas y rótulo.
// El lado cercano al jugador se deja libre para que pueda meter la mano.
import * as THREE from 'three';
import { FIELD } from './physics.js';
import { TEAMS } from './visuals.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

export function buildStadium() {
  const { L, W, goalD } = FIELD;
  const g = new THREE.Group();
  const people = []; // {x,y,z,ry,team,phase}
  const tierD = 0.03, tierH = 0.016, seatGap = 0.0125;
  const concrete = flat(0x9aa3ad), seatA = flat(0x2c4f9e), seatB = flat(0x9e2c3c);

  // Grada recta a lo largo de un eje. dir apunta HACIA FUERA del campo.
  function stand(cx, cz, length, along, dirX, dirZ, tiers, teamFn) {
    for (let t = 0; t < tiers; t++) {
      const h = tierH * (t + 1);
      const off = 0.035 + tierD * t + tierD / 2;
      const geo = along === 'z' ? new THREE.BoxGeometry(tierD, h, length) : new THREE.BoxGeometry(length, h, tierD);
      const m = new THREE.Mesh(geo, t % 2 ? concrete : t === 0 ? seatA : seatB);
      m.position.set(cx + dirX * off, h / 2, cz + dirZ * off);
      g.add(m);
      const n = Math.floor(length / seatGap);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.12) continue; // algún asiento vacío
        const s = -length / 2 + (i + 0.5) * seatGap + (Math.random() - 0.5) * 0.003;
        const px = along === 'z' ? m.position.x : cx + s;
        const pz = along === 'z' ? cz + s : m.position.z;
        people.push({ x: px, y: h, z: pz, ry: Math.atan2(-dirX, -dirZ), team: teamFn(px, pz), phase: Math.random() * 6.28 });
      }
    }
  }
  const sideTeam = () => (Math.random() < 0.5 ? 0 : 1);
  stand(-W / 2, 0, L * 0.92, 'z', -1, 0, 2, sideTeam);
  stand(W / 2, 0, L * 0.92, 'z', 1, 0, 2, sideTeam);
  // fondo lejano: la grada del rival, más alta, detrás de su portería
  stand(0, -L / 2 - goalD + 0.005, W * 0.95, 'x', 0, -1, 3, () => (Math.random() < 0.85 ? 1 : 0));

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

  // Focos en las cuatro esquinas
  const pole = flat(0x5b6570);
  const lamp = flat(0xfff6d5, { emissive: 0xfff2b0, emissiveIntensity: 1.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 + 0.11), z = sz * (L / 2 + 0.06);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.005, 0.2, 6), pole);
    p.position.set(x, 0.1, z);
    g.add(p);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.006), lamp);
    head.position.set(x, 0.205, z);
    head.lookAt(0, 0, 0);
    g.add(head);
  }

  // Banderas en lo alto de la grada lejana
  const flags = [];
  for (const [i, x] of [-W * 0.35, 0, W * 0.35].entries()) {
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.06, 5), pole);
    const base = new THREE.Vector3(x, 0.048 + 0.03, -L / 2 - goalD - 0.035 - tierD * 2.5);
    fp.position.copy(base);
    g.add(fp);
    const team = i === 1 ? 1 : i % 2;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.018, 4, 1), flat(TEAMS[team].shirt, { side: THREE.DoubleSide }));
    flag.position.set(x + 0.015, base.y + 0.02, base.z);
    g.add(flag);
    flags.push(flag);
  }

  // Rótulo CAMPIONI en la fachada de la grada lejana
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x2 = c.getContext('2d');
  x2.fillStyle = '#111a24'; x2.fillRect(0, 0, 1024, 128);
  x2.font = 'bold 92px system-ui, sans-serif'; x2.textAlign = 'center'; x2.textBaseline = 'middle';
  x2.fillStyle = '#ffd34d'; x2.fillText('★ CAMPIONI ★', 512, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.33, W * 0.041), new THREE.MeshBasicMaterial({ map: tex }));
  sign2.position.set(0, 0.062, -L / 2 - goalD - 0.02);
  g.add(sign2);

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
    flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 2.2 + i) * 0.35; });
  }
  update(0, 0);
  return { group: g, update, cheer: (team) => { cheer[team] = 3; }, count: people.length };
}
