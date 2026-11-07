import test from 'node:test';
import assert from 'node:assert/strict';
import { World, makeBody, KIND, setupMatch, FIELD } from '../src/physics.js';
import { thinkSync } from '../src/ai.js';

function run(w, secs = 6) {
  for (let t = 0; t < secs && !w.goal; t += 1 / 60) { w.step(1 / 60); if (w.settled()) break; }
}

test('una chapa lanzada se acaba parando por el rozamiento', () => {
  const w = new World();
  const c = w.add(makeBody(KIND.CAP, 0, 0.2, 0));
  c.vz = -1.5;
  run(w);
  assert.ok(w.settled());
  const dist = 0.2 - c.z;
  assert.ok(dist > 0.15 && dist < 0.5, `recorrido ${dist}`);
});

test('chapa contra garbanzo: el garbanzo sale más rápido que la chapa', () => {
  const w = new World();
  const c = w.add(makeBody(KIND.CAP, 0, 0.1, 0));
  const b = w.add(makeBody(KIND.BALL, 0, 0.05));
  c.vz = -1.2;
  for (let i = 0; i < 6; i++) w.step(1 / 60);
  assert.ok(w.ballTouched);
  assert.ok(b.vz < -1.2, `garbanzo vz ${b.vz}`);
  assert.ok(Math.abs(c.vz) < 1.2);
});

test('la energía no crece en un choque', () => {
  const w = new World();
  const a = w.add(makeBody(KIND.CAP, -0.05, 0, 0));
  const b = w.add(makeBody(KIND.CAP, 0.05, 0.005, 1));
  a.vx = 2;
  const e0 = 0.5 * a.m * 4;
  w.step(1 / 20);
  const e1 = [a, b].reduce((s, x) => s + 0.5 * x.m * (x.vx ** 2 + x.vz ** 2), 0);
  assert.ok(e1 <= e0 + 1e-12);
});

test('el garbanzo que cruza la línea en la portería de arriba es gol del jugador', () => {
  const w = new World();
  const b = w.add(makeBody(KIND.BALL, 0, -0.4));
  b.vz = -1.5;
  run(w);
  assert.deepEqual(w.goal, { scorer: 0 });
});

test('el garbanzo fuera de la portería rebota en la banda y no es gol', () => {
  const w = new World();
  const b = w.add(makeBody(KIND.BALL, 0.15, -0.4));
  b.vz = -1.5;
  run(w, 0.3);
  assert.equal(w.goal, null);
  assert.ok(b.z >= -FIELD.L / 2 && b.vz > 0, 'debe rebotar');
});

test('nada se escapa de la mesa con disparos fuertes al azar', () => {
  const w = setupMatch(new World(), 0);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 40; k++) {
    if (w.goal) setupMatch(w, 0);
    const c = w.bodies[Math.floor(rnd() * 10)];
    c.vx = (rnd() - 0.5) * 5; c.vz = (rnd() - 0.5) * 5;
    run(w, 4);
    for (const b of w.bodies) {
      assert.ok(Math.abs(b.x) <= FIELD.W / 2 + 1e-6, `x fuera ${b.x}`);
      assert.ok(Math.abs(b.z) <= FIELD.L / 2 + FIELD.goalD + 1e-6, `z fuera ${b.z}`);
    }
  }
});

test('la CPU encuentra el gol cuando lo tiene a puerta vacía', () => {
  const w = new World();
  w.add(makeBody(KIND.BALL, 0, 0.3));
  w.add(makeBody(KIND.CAP, 0, 0.2, 1));
  const shot = thinkSync(w, 1, { noise: 0 });
  w.bodies[shot.body].vx = shot.vx; w.bodies[shot.body].vz = shot.vz;
  run(w);
  assert.deepEqual(w.goal, { scorer: 1 });
});

test('la CPU no se mete gol en propia', () => {
  const w = setupMatch(new World(), 1);
  const shot = thinkSync(w, 1, { noise: 0 });
  assert.ok(shot.score > -1000);
  assert.equal(w.bodies[shot.body].team, 1);
});

test('partida simulada de 60 turnos: el garbanzo nunca sale de la mesa', () => {
  const P = { World, setupMatch };
  const w = setupMatch(new World(), 0);
  let turn = 0;
  const inside = (b) => Math.abs(b.x) <= FIELD.W / 2 + 1e-6 && Math.abs(b.z) <= FIELD.L / 2 + FIELD.goalD + 1e-6;
  for (let k = 0; k < 60; k++) {
    if (turn === 0) {
      const ball = w.ball;
      const mine = w.bodies.filter((b) => b.team === 0).sort((a, b) => Math.hypot(a.x - ball.x, a.z - ball.z) - Math.hypot(b.x - ball.x, b.z - ball.z));
      const c = mine[0], dx = ball.x - c.x, dz = ball.z - c.z, d = Math.hypot(dx, dz);
      c.vx = (dx / d) * 2.6; c.vz = (dz / d) * 2.6;
    } else {
      const s = thinkSync(w, 1, { noise: 0.07 });
      w.bodies[s.body].vx = s.vx; w.bodies[s.body].vz = s.vz;
    }
    for (let t = 0; t < 10 && !w.goal; t += 1 / 60) {
      w.step(1 / 60);
      for (const b of w.bodies) assert.ok(inside(b), `${b.kind} fuera: ${b.x.toFixed(3)},${b.z.toFixed(3)} turno ${k}`);
      if (w.settled()) break;
    }
    w.stopAll();
    if (w.goal) { const c = 1 - w.goal.scorer; P.setupMatch(w, c); turn = c; } else turn = 1 - turn;
  }
});

test('la CPU no saca al portero cuando el garbanzo está lejos de su portería', () => {
  for (let k = 0; k < 5; k++) {
    const w = setupMatch(new World(), 1);
    const shot = thinkSync(w, 1, { noise: 0.07 });
    assert.notEqual(w.bodies[shot.body].kind, KIND.KEEPER);
  }
});

test('una chapa no puede meterse en la portería, el garbanzo sí', () => {
  const w = new World();
  const c = w.add(makeBody(KIND.CAP, 0, -0.38, 0));
  c.vz = -2;
  run(w);
  assert.ok(c.z >= -FIELD.L / 2 + c.r - 1e-6, `chapa dentro: ${c.z}`);
  const w2 = new World();
  const b = w2.add(makeBody(KIND.BALL, 0, -0.38));
  b.vz = -2;
  run(w2);
  assert.deepEqual(w2.goal, { scorer: 0 });
});

test('falta: tu chapa toca una rival antes que el garbanzo', () => {
  const w = new World();
  w.add(makeBody(KIND.BALL, 0.2, 0));
  const a = w.add(makeBody(KIND.CAP, 0, 0.1, 0));
  w.add(makeBody(KIND.CAP, 0, 0.0, 1));
  w.shotTeam = 0;
  a.vz = -1.5;
  run(w);
  assert.equal(w.foul, 0);
});

test('no es falta si tocas antes el garbanzo y luego una rival', () => {
  const w = new World();
  w.add(makeBody(KIND.BALL, 0, 0.05));
  const a = w.add(makeBody(KIND.CAP, 0, 0.1, 0));
  w.add(makeBody(KIND.CAP, 0.0, -0.06, 1));
  w.shotTeam = 0;
  a.vz = -1.8;
  run(w);
  assert.equal(w.foul, null);
});
