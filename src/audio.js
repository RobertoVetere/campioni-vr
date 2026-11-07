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

// ---------- Silbato del árbitro ----------
const WHISTLES = {
  short: [[0, 0.32]],
  foul: [[0, 0.14], [0.2, 0.42]],
  goal: [[0, 0.16], [0.24, 0.16], [0.48, 0.75]],
  end: [[0, 0.3], [0.45, 0.3], [0.9, 1.0]],
};
export function whistle(type = 'short') {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (const [st, dur] of WHISTLES[type] || WHISTLES.short) {
    const t = t0 + st;
    const o = ctx.createOscillator(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 2850;
    lfo.frequency.value = 38; lg.gain.value = 140; // el "trino" de la bolita del silbato
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    g.gain.setValueAtTime(0.22, t + dur - 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  }
}

// ---------- Ambiente de grada ----------
let crowd = null;
export function crowdOn() {
  if (!ctx || crowd) return;
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  const g = ctx.createGain(); g.gain.value = 0.05;
  // la grada sube y baja como una ola
  const lfo = ctx.createOscillator(), lg = ctx.createGain();
  lfo.frequency.value = 0.13; lg.gain.value = 0.025;
  lfo.connect(lg).connect(g.gain);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(); lfo.start();
  crowd = { g };
}

// ---------- Sintonía (original, épica, estilo anime de los 80) ----------
// Re mayor, 150 ppm, corcheas. null = la nota anterior se mantiene.
const MEL = [
  74, 78, 81, null, 81, 79, 78, 76,
  78, null, 74, null, 76, null, 69, null,
  71, 74, 79, null, 79, 78, 76, 74,
  76, null, null, null, null, null, 73, 76,
  74, 78, 81, null, 83, 81, 79, 78,
  79, null, 76, null, 78, null, 74, null,
  71, null, 73, null, 74, null, 76, null,
  74, null, null, null, 69, 71, 73, null,
];
const ROOTS = [50, 50, 43, 45, 50, 43, 45, 50];
const CHORDS = { 50: [62, 66, 69], 43: [59, 62, 67], 45: [61, 64, 69] };
const EIGHTH = 60 / 150 / 2;
let music = null;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function note(dest, type, m, t, dur, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = hz(m);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.6, t + dur * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}
function drum(dest, kind, t) {
  if (kind === 'kick') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.16);
    return;
  }
  const len = Math.floor(ctx.sampleRate * (kind === 'snare' ? 0.12 : 0.03));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 1200 : 7000;
  const g = ctx.createGain(); g.gain.value = kind === 'snare' ? 0.25 : 0.08;
  s.connect(f).connect(g).connect(dest); s.start(t);
}

export function musicOn() { return !!music; }
export function toggleMusic(force) {
  if (!ctx) return false;
  const want = force ?? !music;
  if (!want && music) { clearInterval(music.timer); music.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1); music = null; return false; }
  if (want && !music) {
    const out = ctx.createGain(); out.gain.value = 0.11; out.connect(ctx.destination);
    const m = { out, step: 0, next: ctx.currentTime + 0.1 };
    m.timer = setInterval(() => {
      while (m.next < ctx.currentTime + 0.15) {
        const i = m.step % MEL.length, bar = Math.floor(i / 8), e = i % 8, t = m.next;
        const n = MEL[i];
        if (n !== null) {
          let len = 1;
          while (len < 4 && MEL[(i + len) % MEL.length] === null && (i + len) % 8 !== 0) len++;
          note(out, 'square', n, t, EIGHTH * len * 0.95, 0.09);
          note(out, 'triangle', n - 12, t, EIGHTH * len * 0.95, 0.05);
        }
        const root = ROOTS[bar];
        note(out, 'triangle', root - (e % 2 ? 0 : 12) + 12, t, EIGHTH * 0.9, 0.16);
        if (e === 0) for (const c of CHORDS[root]) note(out, 'sawtooth', c - 12, t, EIGHTH * 7.5, 0.018);
        if (e === 0 || e === 4) drum(out, 'kick', t);
        if (e === 2 || e === 6) drum(out, 'snare', t);
        drum(out, 'hat', t);
        m.step++;
        m.next += EIGHTH;
      }
    }, 25);
    music = m;
  }
  return !!music;
}
