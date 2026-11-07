// Reproduce los fallos de Roberto: (1) tras gol del rival el partido sigue; (2) el turno del rival no se eterniza.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4184', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 300000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 700, height: 500 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4184/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const out = await p.evaluate(async () => {
  const g = window.__campioni, w = g.world;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = performance.now(); while (!fn() && performance.now() - t0 < ms) await wait(50); return performance.now() - t0; };
  const res = {};
  g.startMatch();
  // (2) turno del rival: tiro del jugador sin tocar nada -> 2 toques del rival -> vuelve a ti
  const i = w.bodies.findIndex((x) => x.team === 0 && x.num === 2);
  g.fire(i, 0, -0.5, true);
  await until(() => g.state === 'aim', 20000); // tu segundo toque
  g.fire(i, 0.0, -0.4, true);
  await until(() => g.state === 'cpu', 20000);
  const t = await until(() => g.state === 'aim', 60000);
  res.turnoRivalSegundos = +(t / 1000).toFixed(1);
  // (1) gol del rival: balón delante de tu portería, chapa rival detrás, tu portero apartado
  const k = g.myKeeper(); k.tx = 0.09;
  await wait(400);
  w.ball.x = -0.02; w.ball.z = 0.3; w.ball.vx = w.ball.vz = 0;
  const c = w.bodies.find((x) => x.team === 1 && !x.kin);
  c.x = -0.02; c.z = 0.22;
  for (const x of w.bodies) if (x.team === 0 && !x.kin && Math.abs(x.x) < 0.1 && x.z > 0.15) x.x = 0.2;
  g.fire(w.bodies.indexOf(c), 0, 2.2, true);
  const tg = await until(() => g.state === 'replay', 20000);
  res.golDelRival = JSON.stringify(g.score);
  await until(() => g.state === 'aim' || g.state === 'cpu', 60000);
  res.trasGol = g.state;
  // ¿puedo jugar? tiro con la chapa elegida
  await wait(300);
  const sel = g.selected;
  res.hayElegida = !!sel;
  if (sel) { g.fire(w.bodies.indexOf(sel), 0, -1.0, true); await wait(200); res.trasMiToque = g.state; }
  res.barraRivalBien = true;
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
