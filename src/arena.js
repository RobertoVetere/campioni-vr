// Estadio a tamaño real alrededor del jugador (solo en VR completa y en el escritorio):
// la mesa está en el círculo central del césped de un estadio de noche, con miles de aficionados.
import * as THREE from 'three';
import { TEAMS } from './visuals.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });

function pitchTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 680;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#2f7f3a' : '#2a7434'; g.fillRect((i * c.width) / 16, 0, c.width / 16 + 1, c.height); }
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 4;
  const m = 30;
  g.strokeRect(m, m, c.width - 2 * m, c.height - 2 * m);
  g.beginPath(); g.moveTo(c.width / 2, m); g.lineTo(c.width / 2, c.height - m); g.stroke();
  g.beginPath(); g.arc(c.width / 2, c.height / 2, 90, 0, Math.PI * 2); g.stroke();
  for (const x of [m, c.width - m]) {
    const d = x === m ? 1 : -1;
    g.strokeRect(Math.min(x, x + d * 160), c.height / 2 - 200, 160, 400);
    g.strokeRect(Math.min(x, x + d * 55), c.height / 2 - 90, 55, 180);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function skyDome() {
  const geo = new THREE.SphereGeometry(400, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float y = clamp(vP.y, -0.1, 1.0);
        vec3 col = mix(vec3(0.10,0.13,0.22), vec3(0.01,0.02,0.06), pow(max(y,0.0), 0.6));
        vec3 q = floor(vP * 180.0);
        float s = step(0.997, h(q)) * smoothstep(0.05, 0.3, y);
        gl_FragColor = vec4(col + s * 0.9, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

export function buildArena() {
  const g = new THREE.Group();
  g.add(skyDome());

  // césped a escala real (105 × 68 m) con la mesa en el círculo central
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 1 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.rotation.z = Math.PI / 2; // largo hacia delante
  g.add(pitch);
  const around = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), flat(0x22602d));
  around.rotation.x = -Math.PI / 2;
  around.position.y = -0.01;
  g.add(around);

  // porterías de verdad a los dos fondos
  const white = flat(0xffffff);
  for (const s of [-1, 1]) {
    const z = s * 52.5;
    for (const x of [-3.66, 3.66]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 8), white);
      p.position.set(x, 1.22, z);
      g.add(p);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32, 8), white);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.44, z);
    g.add(bar);
  }

  // Gradas: anillo rectangular de 4 lados, escalonadas
  const people = [];
  const tiers = 14, tierD = 1.6, tierH = 1.1;
  const concrete = flat(0x6d7682), seatCols = [flat(0x24438a), flat(0x8a2433)];
  function stand(cx, cz, length, along, dx, dz, start, team) {
    for (let t = 0; t < tiers; t++) {
      const h = tierH * (t + 1) + 1.2;
      const off = start + tierD * t + tierD / 2;
      const geo = along === 'z' ? new THREE.BoxGeometry(tierD, h, length) : new THREE.BoxGeometry(length, h, tierD);
      const m = new THREE.Mesh(geo, t % 3 === 2 ? concrete : seatCols[team === -1 ? t % 2 : team]);
      m.position.set(cx + dx * off, h / 2, cz + dz * off);
      g.add(m);
      const n = Math.floor(length / 1.1);
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.15) continue;
        const sp = -length / 2 + (i + 0.5) * (length / n);
        people.push({
          x: along === 'z' ? m.position.x : cx + sp, y: h, z: along === 'z' ? cz + sp : m.position.z,
          ry: Math.atan2(-dx, -dz), team: team === -1 ? (Math.random() < 0.5 ? 0 : 1) : (Math.random() < 0.85 ? team : 1 - team), phase: Math.random() * 6.28,
        });
      }
    }
    // techo
    const rd = tierD * tiers * 0.6;
    const roof = new THREE.Mesh(along === 'z' ? new THREE.BoxGeometry(rd, 0.4, length + 6) : new THREE.BoxGeometry(length + 6, 0.4, rd), flat(0xb8c2cc));
    const ro = start + tierD * tiers - rd / 2;
    roof.position.set(cx + dx * ro, tierH * tiers + 6, cz + dz * ro);
    g.add(roof);
    // luces bajo el techo
    const strip = new THREE.Mesh(along === 'z' ? new THREE.BoxGeometry(0.3, 0.2, length) : new THREE.BoxGeometry(length, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    strip.position.set(cx + dx * (ro - rd / 2 + 0.3), tierH * tiers + 5.7, cz + dz * (ro - rd / 2 + 0.3));
    g.add(strip);
  }
  stand(-40, 0, 110, 'z', -1, 0, 0, -1);
  stand(40, 0, 110, 'z', 1, 0, 0, -1);
  stand(0, -58, 80, 'x', 0, -1, 0, 1);
  stand(0, 58, 80, 'x', 0, 1, 0, 0);

  // Afición: muchos cuerpos instanciados
  const body = new THREE.BoxGeometry(0.5, 0.8, 0.35); body.translate(0, 0.4, 0);
  const head = new THREE.IcosahedronGeometry(0.2, 0); head.translate(0, 1.0, 0);
  const B = new THREE.InstancedMesh(body, flat(0xffffff), people.length);
  const H = new THREE.InstancedMesh(head, flat(0xffffff), people.length);
  const shirts = TEAMS.map((t) => [new THREE.Color(t.shirt), new THREE.Color(t.stripe === t.shirt ? '#ffffff' : t.stripe)]);
  const skins = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac].map((c) => new THREE.Color(c));
  people.forEach((p, i) => { B.setColorAt(i, shirts[p.team][Math.random() < 0.7 ? 0 : 1]); H.setColorAt(i, skins[i % 5]); });
  g.add(B, H);

  // Torres de focos en las esquinas (y su luz se nota en la mesa)
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const steel = flat(0x4d5560);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 62, z = sz * 72;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 34, 6), steel);
    tower.position.set(x, 17, z);
    g.add(tower);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.6), lampMat);
    panel.position.set(x, 35, z);
    panel.lookAt(0, 0, 0);
    g.add(panel);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(26, 18, 1);
    glow.position.copy(panel.position);
    g.add(glow);
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let cheer = [0, 0], idleT = 0;
  function place(t, all) {
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const c = cheer[p.team] > 0;
      if (!all && !c) continue;
      const j = c ? Math.abs(Math.sin(t * 8 + p.phase)) * 0.7 : 0;
      pos.set(p.x, p.y + j, p.z);
      q.setFromAxisAngle(up, p.ry);
      m4.compose(pos, q, one);
      B.setMatrixAt(i, m4); H.setMatrixAt(i, m4);
    }
    B.instanceMatrix.needsUpdate = true; H.instanceMatrix.needsUpdate = true;
  }
  place(0, true);
  return {
    group: g,
    count: people.length,
    cheer(team) { cheer[team] = 3.5; },
    update(dt, t) {
      const was = cheer.some((c) => c > 0);
      cheer = cheer.map((c) => Math.max(0, c - dt));
      if (cheer.some((c) => c > 0)) place(t, false);
      else if (was) place(t, true); // todos sentados otra vez
      idleT += dt;
    },
  };
}
