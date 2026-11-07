// Efectos de velocidad: estela brillante detrás de lo que va rápido
// y marca en el tapete (que se borra poco a poco) cuando va muy rápido.
import * as THREE from 'three';

const TRAIL_SPEED = 0.7; // m/s: a partir de aquí deja estela
const MARK_SPEED = 1.5; // m/s: a partir de aquí quema el tapete
const TRAIL_LIFE = 0.28; // s
const MARK_LIFE = 3.5; // s

// Discos planos instanciados con alfa por instancia y borde suave
function blobLayer(max, blending, y) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  geo.instanceCount = 0;
  const off = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // x, z, radio
  const col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); // rgb, alfa
  off.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOff', off);
  geo.setAttribute('aCol', col);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending,
    vertexShader: `
      attribute vec3 aOff; attribute vec4 aCol;
      varying vec2 vUv; varying vec4 vCol;
      void main() {
        vUv = uv; vCol = aCol;
        vec3 p = vec3(position.x * aOff.z * 2.0, ${y.toFixed(5)}, -position.y * aOff.z * 2.0);
        p.x += aOff.x; p.z += aOff.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec4 vCol;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.35, d) * vCol.a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vCol.rgb, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const items = []; // {x,z,r,c:Color,life,max,a0}
  return {
    mesh,
    add(x, z, r, color, life, a0) {
      if (items.length >= max) items.shift();
      items.push({ x, z, r, c: color, life, max: life, a0 });
    },
    update(dt) {
      let n = 0;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.life -= dt;
        if (it.life <= 0) items.splice(i, 1);
      }
      for (const it of items) {
        const k = it.life / it.max;
        off.setXYZ(n, it.x, it.z, it.r * (0.6 + 0.4 * k));
        col.setXYZW(n, it.c.r, it.c.g, it.c.b, it.a0 * k * k);
        n++;
      }
      geo.instanceCount = n;
      off.needsUpdate = true; col.needsUpdate = true;
    },
    clear() { items.length = 0; },
  };
}

export function createEffects(teamColors) {
  const group = new THREE.Group();
  const marks = blobLayer(400, THREE.NormalBlending, 0.0003);
  const trails = blobLayer(500, THREE.AdditiveBlending, 0.0035);
  group.add(marks.mesh, trails.mesh);
  const cols = teamColors.map((c) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35));
  const ballCol = new THREE.Color(0xffd27a);
  const scorch = new THREE.Color(0x16210f);
  const lastMark = new Map();

  function update(dt, bodies) {
    for (const b of bodies) {
      const s = Math.hypot(b.vx, b.vz);
      if (s > TRAIL_SPEED) {
        const k = Math.min(1, (s - TRAIL_SPEED) / 1.5);
        const c = b.kind === 'ball' ? ballCol : cols[b.team];
        // varias muestras entre fotogramas para que la estela sea continua
        const steps = 3;
        for (let i = 0; i < steps; i++) {
          const t = (i / steps) * dt;
          trails.add(b.x - b.vx * t, b.z - b.vz * t, b.r * (b.kind === 'ball' ? 1.6 : 0.9), c, TRAIL_LIFE, 0.25 + 0.45 * k);
        }
      }
      if (s > MARK_SPEED) {
        const lm = lastMark.get(b) || { x: 1e9, z: 1e9 };
        if (Math.hypot(b.x - lm.x, b.z - lm.z) > b.r * 0.5) {
          marks.add(b.x, b.z, b.r * (b.kind === 'ball' ? 0.9 : 0.75), scorch, MARK_LIFE, 0.45 * Math.min(1, (s - MARK_SPEED) / 0.8 + 0.4));
          lastMark.set(b, { x: b.x, z: b.z });
        }
      }
    }
    trails.update(dt);
    marks.update(dt);
  }
  return { group, update, clear() { trails.clear(); marks.clear(); } };
}
