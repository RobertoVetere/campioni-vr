// Recibe los registros de prueba del juego y los guarda como archivo en la rama `logs`
// del repo (para poder analizarlos después). Necesita la variable de entorno
// GITHUB_LOG_TOKEN en Vercel: un token de GitHub con permiso de escritura de contenidos
// SOLO en RobertoVetere/campioni-vr.
const REPO = 'RobertoVetere/campioni-vr';
const BRANCH = 'logs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'solo POST' });
  const token = process.env.GITHUB_LOG_TOKEN;
  if (!token) return res.status(503).json({ error: 'falta GITHUB_LOG_TOKEN en Vercel' });
  try {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (body.length > 3_500_000) return res.status(413).json({ error: 'demasiado grande' });
    const data = JSON.parse(body);
    const session = String(data.session || 'sin-sesion').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    const seq = String(Number(data.seq) || 0).padStart(4, '0');
    const path = `logs/${session}/${seq}.json`;
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'campioni-vr-log' },
      body: JSON.stringify({ message: `log ${session} #${seq}`, content: Buffer.from(body).toString('base64'), branch: BRANCH }),
    });
    if (!r.ok) return res.status(502).json({ error: `GitHub ${r.status}`, detail: (await r.text()).slice(0, 300) });
    return res.status(200).json({ ok: true, path });
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
}
