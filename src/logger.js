// Registro de pruebas: graba eventos y muestras de las manos, y los envía cada 30 s
// a /api/log (que los guarda en la rama `logs` del repo). Solo graba si está activado.
const SAMPLE_HZ = 15;
const FLUSH_MS = 30000;
const session = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
let enabled = false;
let seq = 0;
let buf = [];
let lastSample = 0;
let lastFlush = performance.now();
let meta = {};
const recent = []; // últimos eventos, para mostrarlos en el visor
let sending = false;
let status = '';

const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
function compact(o) {
  if (Array.isArray(o)) return o.map(compact);
  if (o && typeof o === 'object') { const out = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = compact(v); return out; }
  return r3(o);
}

export const log = {
  get enabled() { return enabled; },
  get session() { return session; },
  get status() { return status; },
  recent,
  setMeta(m) { meta = { ...meta, ...m }; },
  enable(on) {
    enabled = on;
    if (on) { this.ev('log_on', { ua: navigator.userAgent }); }
    else this.flush();
  },
  // evento puntual: tipo + datos
  ev(type, data = {}) {
    if (!enabled) return;
    const t = Math.round(performance.now());
    buf.push(compact({ t, e: type, ...data }));
    recent.push(`${(t / 1000).toFixed(1)} ${type} ${Object.entries(data).slice(0, 3).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : String(v).slice(0, 12)}`).join(' ')}`);
    if (recent.length > 7) recent.shift();
  },
  // muestra periódica (manos, estado): limitada a SAMPLE_HZ
  sample(fn) {
    if (!enabled) return;
    const now = performance.now();
    if (now - lastSample < 1000 / SAMPLE_HZ) return;
    lastSample = now;
    buf.push(compact({ t: Math.round(now), e: 's', ...fn() }));
    if (now - lastFlush > FLUSH_MS) this.flush();
  },
  async flush() {
    lastFlush = performance.now();
    if (!buf.length || sending) return;
    const events = buf; buf = [];
    const payload = JSON.stringify({ session, seq: seq++, commit: __COMMIT__, meta, events });
    sending = true;
    try {
      const r = await fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: payload.length < 60000 });
      status = r.ok ? `enviado #${seq - 1}` : `error ${r.status}`;
    } catch (e) { status = 'sin conexión'; buf = events.concat(buf); }
    sending = false;
  },
};

// errores de JavaScript también al registro
addEventListener('error', (e) => log.ev('js_error', { msg: e.message, src: `${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', (e) => log.ev('js_error', { msg: String(e.reason) }));
// al ocultarse la página (salir del visor, cerrar), se envía lo pendiente
document.addEventListener('visibilitychange', () => { if (document.hidden) log.flush(); });
