// Prueba en el emulador de Quest 3 (IWER): entra en realidad mixta, pulsa JUGAR con el dedo
// y dispara una chapa dándole con la punta del índice.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', '--port', '5174', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 3000));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 600 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:5174/test-xr.html', { waitUntil: 'load', timeout: 60000 });
await p.waitForSelector('#xrbuttons button', { timeout: 30000 });
const labels = await p.$$eval('#xrbuttons button', (bs) => bs.map((x) => x.textContent));
console.log('botones:', labels);
await p.click('#xrbuttons button');
await new Promise((r) => setTimeout(r, 2500));
const out = await p.evaluate(async () => {
  const g = window.__campioni, dev = window.__dev;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = dev.hands.right;
  R.poseId = 'point';
  const res = { presenting: g.renderer.xr.isPresenting };
  R.position.set(0.15, 1.0, -0.3);
  await wait(400);
  const tip = g.tipWorld(1) || g.tipWorld(0);
  res.tip = tip;
  if (!tip) return res;
  const off = [tip[0] - R.position.x, tip[1] - R.position.y, tip[2] - R.position.z];
  const moveTip = (x, y, z) => R.position.set(x - off[0], y - off[1], z - off[2]);
  // 1) pulsar JUGAR con el dedo (botón en local (0, 0.09, 0.05), inclinado)
  const btn = g.toWorld(0, 0.09, 0.05);
  moveTip(btn[0], btn[1], btn[2] + 0.05); await wait(300);
  for (let k = 0; k <= 10; k++) { moveTip(btn[0], btn[1], btn[2] + 0.05 - k * 0.006); await wait(40); }
  await wait(300);
  res.stateAfterPlay = g.state;
  moveTip(btn[0], btn[1] + 0.2, btn[2] + 0.2); await wait(300);
  // 2) toque de uña: el índice pasa rápido a ras de mesa por una chapa azul, empujándola hacia delante (-z)
  const w = g.world;
  const ci = w.bodies.findIndex((x) => x.team === 0 && x.kind === 'cap' && x.num === 2);
  const c = w.bodies[ci];
  const z0 = c.z, x0 = c.x;
  const startL = [c.x, 0.012, c.z + 0.08];
  let pw = g.toWorld(...startL); moveTip(...pw); await wait(400);
  for (let k = 1; k <= 12; k++) { pw = g.toWorld(c.x, 0.012, startL[2] - k * 0.012); moveTip(...pw); await wait(16); }
  await wait(200);
  res.stateAfterFlick = g.state;
  res.capSpeed = Math.hypot(c.vx, c.vz);
  moveTip(pw[0], pw[1] + 0.3, pw[2] + 0.3);
  await wait(2500);
  res.capMoved = { dx: c.x - x0, dz: c.z - z0 };
  res.board = g.state;
  return res;
});
await p.screenshot({ path: '/tmp/claude-0/sp/xr.png' });
console.log(JSON.stringify(out, null, 1));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill();
