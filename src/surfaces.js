// Superficies de juego: cada una con su textura (hecha por código, estilo propio) y su física.
//  tapete  · fieltro verde liso, el clásico de mesa: corre mucho
//  cesped  · hierba natural con manchas: frena más, el balón rueda menos
//  arena   · playa con ondas y líneas de cuerda: frena mucho, desvía y deja huella
//  tiza    · losa de cemento con tiza torcida: resbala, el balón rueda mucho y bota en los baches
import * as THREE from 'three';
import { FIELD } from './physics.js';

export const SURFACES = {
  tapete: {
    name: 'Tapete',
    mu: { cap: 1, keeper: 1, ball: 1 }, jitter: { cap: 0, keeper: 0, ball: 0 },
    rail: 0x6b3f1f, board: 0x8a5a33, cushion: 0xf2a516,
    marks: { speed: 1.5, life: 3.5, color: 0x16210f, alpha: 0.45 },
  },
  cesped: {
    name: 'Césped',
    mu: { cap: 1.3, keeper: 1.2, ball: 1.55 }, jitter: { cap: 0.08, keeper: 0, ball: 0.18 },
    rail: 0x5a3a1e, board: 0x7a5232, cushion: 0xe8e8e8,
    marks: { speed: 1.3, life: 5, color: 0x24401a, alpha: 0.5 },
  },
  arena: {
    name: 'Arena',
    mu: { cap: 1.75, keeper: 1.6, ball: 2.6 }, jitter: { cap: 0.55, keeper: 0.2, ball: 0.9 },
    rail: 0x1f3c8f, board: 0xc9a46a, cushion: 0x2a56c6,
    marks: { speed: 0.35, life: 9, color: 0x8a6a3a, alpha: 0.55 },
  },
  tiza: {
    name: 'Cemento y tiza',
    mu: { cap: 0.85, keeper: 0.9, ball: 0.7 }, jitter: { cap: 0.12, keeper: 0, ball: 0.45 },
    rail: 0x8d918e, board: 0x6f7470, cushion: 0xb9bdb9,
    marks: { speed: 1.6, life: 3, color: 0x3a3d3b, alpha: 0.35 },
  },
};

// ---------- utilidades de ruido ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function valueNoise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh).map(() => rand());
  return (x, y) => {
    const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy);
    let fx = gx - ix, fy = gy - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1], c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(w, h, rand, cells) {
  const layers = cells.map((c) => valueNoise(w, h, c, rand));
  return (x, y) => { let v = 0, a = 0.5, t = 0; for (const n of layers) { v += n(x, y) * a; t += a; a *= 0.5; } return v / t; };
}
function hex(c) { return [(c >> 16) & 255, (c >> 8) & 255, c & 255]; }

// pinta una base de color con manchas (fbm) y grano por píxel
function paintBase(g, w, h, rand, { c1, c2, cells, grain, extra }) {
  const img = g.createImageData(w, h);
  const n = fbm(w, h, rand, cells);
  const A = hex(c1), B = hex(c2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t = n(x, y);
    if (extra) t = extra(x, y, t);
    const gr = (rand() - 0.5) * grain;
    const i = (y * w + x) * 4;
    img.data[i] = A[0] + (B[0] - A[0]) * t + gr;
    img.data[i + 1] = A[1] + (B[1] - A[1]) * t + gr;
    img.data[i + 2] = A[2] + (B[2] - A[2]) * t + gr;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

// líneas del campo. style: 'paint' | 'rope' | 'chalk'
function drawLines(g, w, h, px, style, rand) {
  const { goalW } = FIELD;
  const m = 0.012 * px;
  const segs = [];
  const line = (x1, y1, x2, y2) => segs.push([x1, y1, x2, y2]);
  const rect = (x, y, rw, rh) => { line(x, y, x + rw, y); line(x + rw, y, x + rw, y + rh); line(x + rw, y + rh, x, y + rh); line(x, y + rh, x, y); };
  const arc = (cx, cy, r, a0, a1) => { const n = 28; for (let i = 0; i < n; i++) { const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n; line(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, cx + Math.cos(t1) * r, cy + Math.sin(t1) * r); } };
  rect(m, m, w - 2 * m, h - 2 * m);
  line(m, h / 2, w - m, h / 2);
  arc(w / 2, h / 2, 0.075 * px, 0, Math.PI * 2);
  for (const top of [true, false]) {
    const aw = (goalW + 0.14) * px, ah = 0.12 * px, sw = (goalW + 0.04) * px, sh = 0.05 * px;
    const y0 = top ? m : h - m, dir = top ? 1 : -1;
    rect(w / 2 - aw / 2, top ? y0 : y0 - ah, aw, ah);
    rect(w / 2 - sw / 2, top ? y0 : y0 - sh, sw, sh);
    arc(w / 2, y0 + dir * ah, 0.04 * px, top ? 0.15 * Math.PI : 1.15 * Math.PI, top ? 0.85 * Math.PI : 1.85 * Math.PI);
  }
  const lw = 0.004 * px;
  g.lineCap = 'round';
  if (style === 'paint') {
    // pintura sobre hierba: blanca pero "comida" por el césped
    g.strokeStyle = 'rgba(245,248,240,0.92)'; g.lineWidth = lw;
    for (const [a, b, c, d] of segs) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200 && img.data[i + 1] > 200 && rand() < 0.22) { img.data[i] -= 90; img.data[i + 1] -= 50; img.data[i + 2] -= 100; }
    g.putImageData(img, 0, 0);
  } else if (style === 'rope') {
    // cuerda azul de fútbol playa, con su sombra
    for (const [pass, col, off] of [[0, 'rgba(60,40,10,0.35)', 2], [1, '#1f3c8f', 0], [2, 'rgba(255,255,255,0.25)', -1]]) {
      g.strokeStyle = col; g.lineWidth = pass === 2 ? lw * 0.35 : lw * 1.1;
      for (const [a, b, c, d] of segs) { g.beginPath(); g.moveTo(a + off, b + off); g.lineTo(c + off, d + off); g.stroke(); }
    }
  } else {
    // tiza: trazos torcidos, desiguales y medio borrados
    for (const [a, b, c, d] of segs) {
      const len = Math.hypot(c - a, d - b), n = Math.max(2, Math.round(len / 6));
      let px0 = a, py0 = b, wob = 0;
      for (let i = 1; i <= n; i++) {
        wob += (rand() - 0.5) * 1.6; wob *= 0.9;
        const t = i / n, nx = -(d - b) / len, ny = (c - a) / len;
        const x = a + (c - a) * t + nx * wob, y = b + (d - b) * t + ny * wob;
        g.strokeStyle = `rgba(250,250,245,${0.45 + rand() * 0.45})`;
        g.lineWidth = lw * (0.7 + rand() * 0.8);
        g.beginPath(); g.moveTo(px0, py0); g.lineTo(x, y); g.stroke();
        px0 = x; py0 = y;
      }
    }
    // polvo de tiza alrededor
    for (let i = 0; i < 2500; i++) {
      const [a, b, c, d] = segs[(rand() * segs.length) | 0];
      const t = rand();
      g.fillStyle = `rgba(255,255,255,${rand() * 0.25})`;
      g.fillRect(a + (c - a) * t + (rand() - 0.5) * 10, b + (d - b) * t + (rand() - 0.5) * 10, 1.5, 1.5);
    }
  }
  // puntos de penalti y centro
  g.fillStyle = style === 'rope' ? '#1f3c8f' : 'rgba(250,250,245,0.9)';
  for (const y of [m + 0.09 * px, h - m - 0.09 * px, h / 2]) { g.beginPath(); g.arc(w / 2, y, 0.004 * px, 0, Math.PI * 2); g.fill(); }
}

const cache = {};
export function surfaceTexture(type) {
  if (cache[type]) return cache[type];
  const { L, W } = FIELD;
  const px = 1300;
  const w = Math.round(W * px), h = Math.round(L * px);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rand = rng(type.length * 977 + 13);

  if (type === 'cesped') {
    paintBase(g, w, h, rand, { c1: 0x2f7a2c, c2: 0x5aa83f, cells: [160, 60, 18], grain: 26 });
    // briznas: miles de trazos cortos en varios verdes
    for (let i = 0; i < 26000; i++) {
      const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = 2 + rand() * 4;
      const v = rand();
      g.strokeStyle = v < 0.5 ? `rgba(40,${100 + rand() * 50},35,0.55)` : `rgba(${90 + rand() * 40},${160 + rand() * 40},70,0.45)`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    drawLines(g, w, h, px, 'paint', rand);
    const v = g.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,30,0,0.28)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  } else if (type === 'arena') {
    const ripple = valueNoise(w, h, 90, rand);
    paintBase(g, w, h, rand, {
      c1: 0xc9a066, c2: 0xead09a, cells: [200, 70, 20], grain: 30,
      extra: (x, y, t) => t * 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(y * 0.09 + ripple(x, y) * 9 + x * 0.015)),
    });
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(120,90,50,${rand() * 0.5})` : `rgba(255,245,220,${rand() * 0.5})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand(), 1 + rand());
    }
    // algunas huellas y conchitas
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(140,105,60,0.18)';
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 8 + rand() * 10, 4 + rand() * 5, rand() * 3, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(250,240,230,0.85)';
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 3, 2, rand() * 3, 0, Math.PI * 2); g.fill();
    }
    drawLines(g, w, h, px, 'rope', rand);
  } else if (type === 'tiza') {
    paintBase(g, w, h, rand, { c1: 0x7d8480, c2: 0xa9afab, cells: [220, 80, 25], grain: 34 });
    // manchas de humedad y desgaste
    for (let i = 0; i < 30; i++) {
      const x = rand() * w, y = rand() * h, r = 20 + rand() * 70;
      const q = g.createRadialGradient(x, y, 0, x, y, r);
      q.addColorStop(0, `rgba(60,64,62,${0.12 + rand() * 0.15})`); q.addColorStop(1, 'rgba(60,64,62,0)');
      g.fillStyle = q; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // piedrecitas del hormigón
    for (let i = 0; i < 7000; i++) {
      const s = rand() * 2.4 + 0.6;
      g.fillStyle = rand() < 0.6 ? `rgba(70,72,70,${0.3 + rand() * 0.4})` : `rgba(215,218,214,${0.3 + rand() * 0.4})`;
      g.fillRect(rand() * w, rand() * h, s, s);
    }
    // grietas
    g.strokeStyle = 'rgba(35,38,37,0.55)'; g.lineWidth = 1.3;
    for (let k = 0; k < 6; k++) {
      let x = rand() * w, y = rand() * h, a = rand() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 40; i++) { a += (rand() - 0.5) * 0.9; x += Math.cos(a) * 5; y += Math.sin(a) * 5; g.lineTo(x, y); }
      g.stroke();
    }
    drawLines(g, w, h, px, 'chalk', rand);
  } else {
    // tapete de fieltro: franjas y grano fino
    paintBase(g, w, h, rand, { c1: 0x36924a, c2: 0x3fa34d, cells: [400], grain: 8, extra: (x, y) => (Math.floor((y / h) * 10) % 2 ? 0.85 : 0.15) });
    drawLines(g, w, h, px, 'paint', () => 1);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache[type] = t;
  return t;
}
