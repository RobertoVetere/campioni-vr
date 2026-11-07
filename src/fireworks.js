// Fuegos artificiales para celebrar los goles (sobre la mesa y sobre el estadio grande).
import * as THREE from 'three';

export function createFireworks(parent, { scale = 1, max = 1500, size = 0.01 } = {}) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), vel = new Float32Array(max * 3), life = new Float32Array(max);
  for (let k = 0; k < max; k++) pos[k * 3 + 1] = -1e4; // fuera de la vista hasta que exploten
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: size * scale, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  parent.add(pts);
  let next = 0, active = 0;
  const rockets = [];
  const palette = [0xffd34d, 0x6ea2ff, 0xff6b7d, 0x7dffa1, 0xffffff, 0xff9f2e].map((c) => new THREE.Color(c));

  function burst(x, y, z, color) {
    const n = 90;
    for (let i = 0; i < n; i++) {
      const k = next; next = (next + 1) % max;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      const sp = (0.55 + Math.random() * 0.45) * scale;
      pos.set([x, y, z], k * 3);
      vel.set([Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp], k * 3);
      const c = Math.random() < 0.2 ? palette[4] : color;
      col.set([c.r, c.g, c.b], k * 3);
      life[k] = 1.4 + Math.random() * 0.6;
    }
    active = max;
  }
  return {
    // lanza n cohetes desde puntos al azar dentro de un área
    launch(n, area) {
      for (let i = 0; i < n; i++) {
        rockets.push({
          x: area.x + (Math.random() - 0.5) * area.w, z: area.z + (Math.random() - 0.5) * area.d,
          y: area.y, vy: (1.6 + Math.random() * 0.6) * scale, t: 0, delay: i * 0.18 + Math.random() * 0.2,
          color: palette[(Math.random() * 4) | 0],
        });
      }
    },
    update(dt) {
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        if (r.delay > 0) { r.delay -= dt; continue; }
        r.y += r.vy * dt; r.vy -= 2.2 * scale * dt; r.t += dt;
        if (r.vy < 0.25 * scale || r.t > 1.4) { burst(r.x, r.y, r.z, r.color); rockets.splice(i, 1); }
      }
      if (!active) return;
      let alive = 0;
      for (let k = 0; k < max; k++) {
        if (life[k] <= 0) continue;
        life[k] -= dt;
        vel[k * 3 + 1] -= 0.9 * scale * dt;
        vel[k * 3] *= 0.985; vel[k * 3 + 1] *= 0.985; vel[k * 3 + 2] *= 0.985;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        if (life[k] <= 0) { pos[k * 3 + 1] = -1e4; continue; }
        if (life[k] < 0.5) { col[k * 3] *= 0.93; col[k * 3 + 1] *= 0.93; col[k * 3 + 2] *= 0.93; }
        alive++;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      if (!alive) active = 0;
    },
  };
}
