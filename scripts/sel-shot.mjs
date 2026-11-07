// Captura de cerca de una chapa elegida (brillo azul + radio) en un partido
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4191', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 900, height: 600 });
await p.goto('http://localhost:4191/', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await p.evaluate(() => { document.getElementById('ui').style.display = 'none'; const g = window.__campioni; g.startMatch(); const c = g.camera; c.position.set(0, 1.05, 0.4); c.lookAt(0, 0.8, 0.05); });
await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: '/tmp/claude-0/sp/seleccion.png' });
await b.close(); srv.kill(); process.exit(0);
