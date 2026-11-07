// Registro: con ?log=1 se graban eventos y se intenta enviar a /api/log
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4189', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
await new Promise((r) => setTimeout(r, 2500));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', protocolTimeout: 120000, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-proxy-server'] });
const p = await b.newPage();
await p.setViewport({ width: 800, height: 600 });
const errs = [], posts = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('request', (r) => { if (r.url().includes('/api/log')) posts.push(r.postData()?.length || 0); });
await p.goto('http://localhost:4189/?log=1', { waitUntil: 'load', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const out = await p.evaluate(async () => {
  const g = window.__campioni;
  g.startMatch();
  const i = g.world.bodies.findIndex((x) => x.team === 0 && x.num === 2);
  g.fire(i, 0, -0.8, true);
  await new Promise((r) => setTimeout(r, 2500));
  await g.log.flush();
  return { enabled: g.log.enabled, recent: g.log.recent, status: g.log.status };
});
console.log(JSON.stringify(out, null, 1));
console.log('envíos a /api/log:', posts.length, 'bytes', posts);
console.log('ERRORES:', errs.length ? errs.join('\n') : 'ninguno');
await b.close(); srv.kill(); process.exit(0);
