import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: '/home/claude/campioni-vr' });
await new Promise(r => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 760 });
const errs = [];
p.on('pageerror', e => errs.push('pageerror ' + e.message));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text()); });
await p.goto('http://localhost:4173/', { waitUntil: 'load', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: '/tmp/claude-0/sp/inicio.png' });
// partida automática: el jugador dispara hacia el garbanzo, la CPU responde
const res = await p.evaluate(async () => {
  const g = window.__campioni; g.startMatch();
  const log = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  for (let k = 0; k < 14; k++) {
    for (let t = 0; t < 200 && g.state !== 'aim' && g.state !== 'end'; t++) await wait(100);
    if (g.state === 'end') break;
    const w = g.world, ball = w.ball;
    const caps = w.bodies.map((b, i) => [b, i]).filter(([b]) => b.team === 0);
    caps.sort((a, b) => Math.hypot(a[0].x - ball.x, a[0].z - ball.z) - Math.hypot(b[0].x - ball.x, b[0].z - ball.z));
    const [c, i] = caps[0];
    const dx = ball.x - c.x, dz = ball.z - c.z, d = Math.hypot(dx, dz);
    g.fire(i, dx / d * 2.2, dz / d * 2.2);
    log.push(`turno ${k}: ${g.score.join('-')}`);
    await wait(300);
  }
  return { log, score: g.score, state: g.state };
});
await p.screenshot({ path: '/tmp/claude-0/sp/partida.png' });
console.log(JSON.stringify(res));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill();
