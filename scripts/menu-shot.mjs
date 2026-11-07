// Capturas del menú principal y de un submenú
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4185', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 650 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4185/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 2000));
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; window.__campioni.startMatch(); window.__campioni.openMenu(); });
await new Promise((r) => setTimeout(r, 1200));
await p.screenshot({ path: '/tmp/claude-0/sp/menu-principal.png' });
// pulsar "Controles" con el ratón: centro de la pantalla, 4º botón
await p.evaluate(() => window.__campioni.showPage('controles'));
await new Promise((r) => setTimeout(r, 1000));
await p.screenshot({ path: '/tmp/claude-0/sp/menu-controles.png' });
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
