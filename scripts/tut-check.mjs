// Tutorial en escritorio: pasos con eventos simulados, capturas del panel y la mano fantasma.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4187', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 300000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 650 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4187/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; window.__campioni.startTutorial(); });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: '/tmp/claude-0/sp/tut-1.png' });
const steps = await p.evaluate(async () => {
  const g = window.__campioni, out = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  g.tutEvent('shot'); out.push('evento equivocado -> paso ' + (g.tut.step + 1)); // no debe avanzar
  const c = g.world.bodies.find((x) => x.team === 0 && x.kind === 'cap' && x !== g.selected);
  g.select(c); out.push('tras elegir -> paso ' + (g.tut.step + 1));
  g.tutEvent('drag'); out.push('tras arrastrar -> paso ' + (g.tut.step + 1));
  return out;
});
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: '/tmp/claude-0/sp/tut-3.png' });
const end = await p.evaluate(async () => {
  const g = window.__campioni;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sel = g.selected; g.fire(g.world.bodies.indexOf(sel), 0, -0.6, true);
  await wait(200);
  g.tutEvent('lever');
  const fin = g.tut && g.tut.fin > 0;
  await wait(4000);
  return { fin, modo: g.mode, estado: g.state, hecho: g.progress.tutorialDone };
});
console.log(steps.join('\n'));
console.log(JSON.stringify(end));
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
