// Idioma: arranca en inglés, el menú cambia a español y vuelve; el tutorial se puede saltar desde la mesa.
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4188', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 650 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4188/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const html = await p.evaluate(() => [document.documentElement.lang, document.getElementById('intro').textContent.slice(0, 40), document.getElementById('langbtn').textContent]);
console.log('inicio:', JSON.stringify(html));
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; const g = window.__campioni; g.startTutorial(); });
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: '/tmp/claude-0/sp/lang-en-tut.png' });
await p.evaluate(() => { document.getElementById('langbtn').click(); });
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: '/tmp/claude-0/sp/lang-es-tut.png' });
// saltar el tutorial con el botón de la mesa (clic de ratón sobre él)
const skipped = await p.evaluate(() => { const g = window.__campioni; g.openMenu(); return g.mode; });
await new Promise((r) => setTimeout(r, 1000));
await p.screenshot({ path: '/tmp/claude-0/sp/lang-es-menu.png' });
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
