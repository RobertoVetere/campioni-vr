// Prueba en Chrome sin pantalla: arranca, provoca un gol, comprueba falta, repetición y que no hay errores.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 600000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage();
await p.setViewport({ width: 1100, height: 760 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.type() + ' ' + m.text()); });
await p.goto('http://localhost:4173/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const shot = (name) => p.screenshot({ path: `/tmp/claude-0/sp/${name}.png` });
const ev = (fn, arg) => p.evaluate(fn, arg);
const states = [];
await ev(() => window.__campioni.startMatch());
// 1) primer toque: aproximación (sin tocar nada) -> sigue siendo turno del jugador, toque 2
await ev(() => { const g = window.__campioni; const i = g.world.bodies.findIndex((x) => x.team === 0 && x.num === 2); g.fire(i, 0, -0.6); });
await p.waitForFunction(() => window.__campioni.state === 'aim', { timeout: 120000 });
states.push('tras toque 1: ' + (await ev(() => window.__campioni.state)) + ' touchesLeft=' + (await ev(() => window.__campioni.touchesLeft)));
// 2) gol preparado: garbanzo delante de la portería rival y una chapa detrás
await ev(() => {
  const g = window.__campioni, w = g.world;
  w.ball.x = 0; w.ball.z = -0.3;
  const i = w.bodies.findIndex((x) => x.team === 0 && x.num === 3);
  w.bodies[i].x = 0; w.bodies[i].z = -0.15;
  for (const x of w.bodies) if (x.team === 1) x.x = Math.sign(x.x || 1) * 0.2; // apartar rivales
  g.fire(i, 0, -2.4);
});
await new Promise((r) => setTimeout(r, 250));
await shot('estela');
await p.waitForFunction(() => window.__campioni.state === 'replay', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1500));
await shot('repeticion');
states.push('marcador: ' + JSON.stringify(await ev(() => window.__campioni.score)));
await p.waitForFunction(() => ['aim', 'cpu'].includes(window.__campioni.state), { timeout: 200000 });
states.push('tras repetición: ' + (await ev(() => window.__campioni.state)));
console.log(states.join('\n'));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill();
