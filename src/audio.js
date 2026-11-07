// Sonidos sintetizados (sin archivos): golpe de chapa, banda y gol.
let ctx = null;
let last = 0;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
    if (ctx) { loadSample('musica'); loadSample('gol'); loadSample('grada'); }
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
  crowdSwell(1);
  if (playSample('gol', 0.7)) return;
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

// ---------- Grabaciones opcionales (public/sounds/*.mp3) ----------
// Si existen, sustituyen al sonido sintetizado. Si no, no pasa nada.
const samples = {};
async function loadSample(name) {
  if (!ctx || samples[name] !== undefined) return samples[name];
  samples[name] = null;
  try {
    const r = await fetch(`/sounds/${name}.mp3`);
    if (!r.ok) return null;
    samples[name] = await ctx.decodeAudioData(await r.arrayBuffer());
  } catch (e) { samples[name] = null; }
  return samples[name];
}
export function playSample(name, vol = 0.6) {
  const b = samples[name];
  if (!ctx || !b) return false;
  const s = ctx.createBufferSource(); s.buffer = b;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(g).connect(ctx.destination); s.start();
  return true;
}

// ---------- Ambiente de grada ----------
// Murmullo de mucha gente: ruido en varias bandas de voz con "sílabas" aleatorias. Bajito.
let crowd = null;
export function crowdOn() {
  if (!ctx || crowd) return;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  crowd = { master, level: 1 };
  loadSample('gol');
  loadSample('grada').then((buf) => {
    if (buf) {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0.35;
      src.connect(g).connect(master); src.start();
      return;
    }
    const len = ctx.sampleRate * 3;
    const buf2 = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf2.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (const [f, q, v] of [[320, 1.2, 0.5], [650, 1.6, 0.45], [1150, 2.2, 0.3], [2300, 3, 0.12]]) {
      const src = ctx.createBufferSource(); src.buffer = buf2; src.loop = true;
      src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = v;
      // "sílabas": la intensidad de cada banda tiembla a ritmo de habla
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 3 + Math.random() * 4; lg.gain.value = v * 0.35;
      lfo.connect(lg).connect(g.gain);
      src.connect(bp).connect(g).connect(master);
      src.start(); lfo.start();
    }
  });
  crowdVolume(1);
}
export function crowdVolume(v) {
  if (!crowd) return;
  crowd.level = v;
  crowd.master.gain.setTargetAtTime(v * 0.035, ctx.currentTime, 0.4);
}
// la grada se viene arriba un momento (gol, ocasión)
export function crowdSwell(k = 1) {
  if (!crowd || crowd.level === 0) return;
  const t = ctx.currentTime;
  crowd.master.gain.cancelScheduledValues(t);
  crowd.master.gain.setTargetAtTime(0.035 * (1 + 3 * k), t, 0.08);
  crowd.master.gain.setTargetAtTime(0.035, t + 1.8, 0.8);
}

// ---------- Sintonía: rock épico de anime de los 80 (original) ----------
// Guitarra eléctrica sintetizada (sierra + distorsión), bajo, batería. Re mayor, 156 ppm.
// 0 = silencio, null = mantener la nota anterior.
const BPM = 156;
const EIGHTH = 60 / BPM / 2;
const N = null;
const SONG = [
  // intro: solo power chords
  { ch: 'D', mel: [0, 0, 0, 0, 0, 0, 0, 0] }, { ch: 'D', mel: [0, 0, 0, 0, 0, 0, 0, 0] },
  { ch: 'A', mel: [0, 0, 0, 0, 0, 0, 0, 0] }, { ch: 'A', mel: [0, 0, 0, 0, 69, 71, 73, 0] },
  // estrofa
  { ch: 'D', mel: [74, 0, 74, 76, 78, N, 76, 74] }, { ch: 'A', mel: [76, N, 73, N, 69, N, N, 0] },
  { ch: 'Bm', mel: [71, 0, 71, 73, 74, N, 73, 71] }, { ch: 'G', mel: [74, N, N, N, 71, N, 69, N] },
  { ch: 'D', mel: [74, 0, 74, 76, 78, N, 81, N] }, { ch: 'A', mel: [79, N, 78, N, 76, N, 73, N] },
  { ch: 'G', mel: [74, N, 76, N, 78, N, 79, N] }, { ch: 'A', mel: [81, N, N, N, N, N, 0, 0] },
  // estribillo (sube todo)
  { ch: 'G', mel: [83, N, 81, N, 79, N, 78, N] }, { ch: 'A', mel: [81, N, N, 79, 78, N, 76, N] },
  { ch: 'Bm', mel: [78, N, 79, N, 81, N, 83, N] }, { ch: 'A', mel: [85, N, N, N, 81, N, 85, N] },
  { ch: 'G', mel: [86, N, N, 85, 83, N, 81, N] }, { ch: 'A', mel: [83, N, 81, N, 79, N, 78, 76] },
  { ch: 'D', mel: [78, N, N, N, 74, N, N, N] }, { ch: 'D', mel: [74, N, N, N, 0, 0, 0, 0] },
];
const LOOP_FROM = 4; // tras la intro, se repite desde la estrofa
const ROOT = { D: 38, A: 45, Bm: 47, G: 43 };
let music = null;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return c;
}
function makeAmp(out, drive, tone, vol) {
  const inp = ctx.createGain();
  const sh = ctx.createWaveShaper(); sh.curve = distCurve(drive); sh.oversample = '2x';
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = tone;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 900; mid.gain.value = 4;
  const g = ctx.createGain(); g.gain.value = vol;
  inp.connect(sh).connect(lp).connect(mid).connect(g).connect(out);
  return inp;
}
function guitarNote(bus, m, t, dur, vibrato) {
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
    if (vibrato) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(18, t + Math.min(0.4, dur));
      l.connect(lg).connect(o.detune); l.start(t); l.stop(t + dur + 0.05);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }
}
function drum(out, kind, t) {
  if (kind === 'kick') {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.17);
    return;
  }
  const dur = kind === 'snare' ? 0.16 : kind === 'crash' ? 1.2 : 0.035;
  const len = Math.floor(ctx.sampleRate * dur);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, kind === 'crash' ? 2 : 1);
  const s = ctx.createBufferSource(); s.buffer = b;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 900 : 6000;
  const g = ctx.createGain(); g.gain.value = { snare: 0.55, hat: 0.12, crash: 0.22 }[kind];
  s.connect(f).connect(g).connect(out); s.start(t);
  if (kind === 'snare') { // cuerpo del redoble
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = 190; og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.1);
  }
}

export function musicOn() { return !!music; }
export function toggleMusic(force) {
  if (!ctx) return false;
  const want = force ?? !music;
  if (!want && music) { clearInterval(music.timer); music.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1); if (music.stop) music.stop(); music = null; return false; }
  if (want && !music && samples.musica) {
    // si hay una canción de verdad en public/sounds/musica.mp3, suena esa en bucle
    const out = ctx.createGain(); out.gain.value = 0.35; out.connect(ctx.destination);
    const src = ctx.createBufferSource(); src.buffer = samples.musica; src.loop = true;
    src.connect(out); src.start();
    music = { out, timer: null, stop: () => src.stop(ctx.currentTime + 0.3) };
    return true;
  }
  if (want && !music) {
    const out = ctx.createGain(); out.gain.value = 0.085; out.connect(ctx.destination);
    const rhythm = makeAmp(out, 18, 2600, 0.22); // power chords
    const lead = makeAmp(out, 9, 3800, 0.3); // melodía
    // eco para la guitarra solista
    const delay = ctx.createDelay(); delay.delayTime.value = EIGHTH * 1.5;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    const leadBus = ctx.createGain();
    leadBus.connect(lead); leadBus.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(lead);
    const m = { out, step: 0, next: ctx.currentTime + 0.1 };
    m.timer = setInterval(() => {
      while (m.next < ctx.currentTime + 0.15) {
        let bar = Math.floor(m.step / 8);
        if (bar >= SONG.length) { m.step = LOOP_FROM * 8; bar = LOOP_FROM; }
        const e = m.step % 8, t = m.next;
        const sec = SONG[bar];
        const root = ROOT[sec.ch];
        const chorus = bar >= 12;
        // power chord a corcheas; acentos en 1 y 3, apagado (palm mute) en el resto
        const accent = e === 0 || e === 4 || (chorus && e % 2 === 0);
        for (const iv of [12, 19, 24]) guitarNote(rhythm, root + iv, t, accent ? EIGHTH * 1.8 : EIGHTH * 0.6);
        // bajo
        const bo = ctx.createOscillator(), bg = ctx.createGain();
        bo.type = 'triangle'; bo.frequency.value = hz(root + (e % 4 === 3 ? 12 : 0));
        bg.gain.setValueAtTime(0.45, t); bg.gain.exponentialRampToValueAtTime(0.0001, t + EIGHTH * 0.95);
        bo.connect(bg).connect(out); bo.start(t); bo.stop(t + EIGHTH);
        // melodía
        const n = sec.mel[e];
        if (n) {
          let len = 1;
          while (len < 6 && e + len < 8 && sec.mel[e + len] === null) len++;
          guitarNote(leadBus, n, t, EIGHTH * len * 0.98, len >= 2);
        }
        // batería
        if (e === 0 || e === 4 || e === 5) drum(out, 'kick', t);
        if (e === 2 || e === 6) drum(out, 'snare', t);
        if (chorus && e === 7) drum(out, 'snare', t);
        if (e === 0 && (bar % 4 === 0 || bar === 12)) drum(out, 'crash', t);
        else drum(out, 'hat', t);
        m.step++;
        m.next += EIGHTH;
      }
    }, 25);
    music = m;
  }
  return !!music;
}
