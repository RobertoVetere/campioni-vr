// Mano fantasma del tutorial: una mano translúcida low poly que enseña cada gesto.
// Poses: 'point' (índice estirado), 'flat' (palma abierta), 'fist' (agarrando).
import * as THREE from 'three';

export function createGhostHand() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x6ec8ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const edge = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false, toneMapped: false });
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    const w = new THREE.Mesh(geo, edge); m.add(w);
    g.add(m); return m;
  };
  // palma (mirando hacia abajo); los dedos salen hacia -z (hacia delante)
  const palm = add(new THREE.BoxGeometry(0.07, 0.016, 0.075), 0, 0, 0);
  const fingers = [];
  const xs = [-0.026, -0.009, 0.009, 0.026];
  const lens = [0.06, 0.068, 0.064, 0.05];
  xs.forEach((x, i) => {
    const geo = new THREE.BoxGeometry(0.015, 0.013, 1);
    geo.translate(0, 0, -0.5);
    const f = add(geo, x, 0, -0.037);
    f.userData.len = lens[i];
    fingers.push(f);
  });
  const thumbGeo = new THREE.BoxGeometry(0.016, 0.014, 1);
  thumbGeo.translate(0, 0, -0.5);
  const thumb = add(thumbGeo, 0.04, -0.002, 0.01);
  thumb.rotation.y = -0.7;
  thumb.userData.len = 0.045;

  function pose(name) {
    if (name === 'pinch') {
      // índice y pulgar juntos, el resto relajados
      fingers.forEach((f, i) => { f.scale.z = f.userData.len * (i === 1 ? 0.75 : 0.9); f.rotation.x = i === 1 ? -1.0 : -0.25; });
      thumb.scale.z = thumb.userData.len; thumb.rotation.y = -1.15;
      return;
    }
    fingers.forEach((f, i) => {
      const ext = name === 'flat' || (name === 'point' && i === 1);
      f.scale.z = ext ? f.userData.len : f.userData.len * 0.35;
      // girar en negativo dobla hacia abajo (los dedos salen hacia -z)
      f.rotation.x = ext ? (name === 'point' && i === 1 ? -0.35 : 0) : -1.45;
    });
    thumb.scale.z = name === 'fist' ? thumb.userData.len * 0.6 : thumb.userData.len;
    thumb.rotation.y = name === 'fist' ? -1.3 : -0.7;
  }
  function side(s) {
    g.scale.x = s === 'left' ? -1 : 1; // mano izquierda = espejo
    mat.color.set(s === 'left' ? 0x6ec8ff : 0xffa94d); // izquierda azul (mueve), derecha naranja (tira)
  }
  pose('flat');
  side('right');
  g.visible = false;
  return { group: g, pose, side };
}
