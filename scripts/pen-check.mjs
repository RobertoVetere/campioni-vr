// Tanda de penaltis automática: tú tiras siempre al mismo sitio; comprueba que la tanda avanza y termina.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4186', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 600000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 640, height: 480 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4186/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const out = await p.evaluate(async () => {
  const g = window.__campioni, w = g.world;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.startPenalties();
  const log = [];
  for (let n = 0; n < 16 && g.state !== 'end'; n++) {
    const t0 = performance.now();
    while (!['aim', 'end'].includes(g.state) && performance.now() - t0 < 60000) await wait(60);
    if (g.state === 'end') break;
    const c = w.bodies.find((x) => x.team === 0 && x.kind === 'cap');
    const ball = w.ball;
    const tx = (n % 2 ? 0.06 : -0.06), tz = -0.45;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    g.fire(w.bodies.indexOf(c), (dx / d) * 1.9, (dz / d) * 1.9, true);
    log.push(`${g.pen.kicks[0].map(Number).join('')} - ${g.pen.kicks[1].map(Number).join('')}`);
    await wait(200);
  }
  const t0 = performance.now();
  while (g.state !== 'end' && performance.now() - t0 < 60000) await wait(100);
  return { final: g.state, kicks: g.pen.kicks.map((k) => k.map(Number).join('')), score: g.score, progress: { penWins: g.progress.penWins, penLosses: g.progress.penLosses }, log };
});
await p.screenshot({ path: '/tmp/claude-0/sp/penaltis.png' });
console.log(JSON.stringify(out, null, 1));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
