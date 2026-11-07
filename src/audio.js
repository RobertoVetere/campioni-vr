// Sonidos sintetizados (sin archivos): golpe de chapa, banda y gol.
let ctx = null;
let last = 0;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function click(freq, vol, dur, type = 'triangle') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function hitSound(speed, kind) {
  const now = performance.now();
  if (now - last < 25) return; // no saturar
  last = now;
  const v = Math.min(0.5, speed * 0.25);
  if (v < 0.02) return;
  if (kind === 'wall') boing(v);
  else if (kind === 'net') click(200, v * 0.5, 0.05, 'sine');
  else if (kind === 'ball') click(2400, v, 0.03);
  else click(1500 + Math.random() * 300, v, 0.05);
}

export function flickSound() {
  click(900, 0.35, 0.04, 'square');
}

export function goalSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // ruido de "grada" + acorde
  const len = ctx.sampleRate * 1.6;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.6;
  const g = ctx.createGain(); g.gain.value = 0.35;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(t);
  [523, 659, 784].forEach((fr, i) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = fr;
    og.gain.setValueAtTime(0.0001, t + i * 0.08);
    og.gain.exponentialRampToValueAtTime(0.15, t + i * 0.08 + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(og).connect(ctx.destination);
    o.start(t + i * 0.08); o.stop(t + 1);
  });
}

export function buttonSound() {
  click(660, 0.2, 0.05, 'sine');
}

// rebote en la goma: un "boing" corto y suave
function boing(v) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(320, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
  g.gain.setValueAtTime(v * 0.7, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + 0.16);
}
