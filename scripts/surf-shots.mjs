// Capturas de las cuatro superficies desde arriba
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4182', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 700 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4182/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; const g = window.__campioni; g.root.children.forEach(() => {}); const c = g.camera; c.position.set(0, 1.25, 0.42); c.lookAt(0, 0.8, -0.05); });
for (const s of ['cesped', 'arena', 'tiza', 'tapete']) {
  await p.evaluate((s) => window.__campioni.setSurface(s), s);
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `/tmp/claude-0/sp/campo-${s}.png` });
}
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
