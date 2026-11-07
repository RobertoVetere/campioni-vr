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

test('tiro libre: con la chapa volteada el balón sale por el aire y pasa por encima de una chapa', () => {
  const w = new World();
  const ball = w.add(makeBody(KIND.BALL, 0, 0.05));
  const kicker = w.add(makeBody(KIND.CAP, 0, 0.08, 0));
  const wall = w.add(makeBody(KIND.CAP, 0, -0.06, 1)); // barrera
  kicker.flipped = true;
  kicker.vz = -2.2;
  let maxY = 0, touchedWall = false;
  for (let t = 0; t < 3; t += 1 / 60) {
    w.step(1 / 60);
    maxY = Math.max(maxY, ball.y);
    if (Math.hypot(wall.vx, wall.vz) > 0.05 && Math.hypot(ball.x - wall.x, ball.z - wall.z) < 0.03) touchedWall = true;
    if (w.settled()) break;
  }
  assert.ok(maxY > 0.02, `altura ${maxY}`);
  assert.ok(ball.z < -0.1, `el balón ha pasado la barrera: ${ball.z}`);
  assert.equal(ball.y, 0, 'vuelve al suelo');
});

test('sin voltear, la misma jugada no levanta el balón', () => {
  const w = new World();
  const ball = w.add(makeBody(KIND.BALL, 0, 0.05));
  const kicker = w.add(makeBody(KIND.CAP, 0, 0.08, 0));
  kicker.vz = -1.6;
  let maxY = 0;
  for (let t = 0; t < 2; t += 1 / 60) { w.step(1 / 60); maxY = Math.max(maxY, ball.y); }
  assert.equal(maxY, 0);
});

test('un balón por encima del larguero no es gol', () => {
  const w = new World();
  const b = w.add(makeBody(KIND.BALL, 0, -0.42));
  b.y = 0.05; b.vy = 0.5; b.vz = -1.2;
  for (let t = 0; t < 0.15; t += 1 / 60) w.step(1 / 60);
  assert.equal(w.goal, null);
});

test('en tiro libre la CPU solo tira con la chapa volteada', () => {
  const w = setupMatch(new World(), 1);
  const c = w.bodies.find((b) => b.team === 1 && b.num === 3);
  c.flipped = true;
  const shot = thinkSync(w, 1, { noise: 0 });
  assert.equal(w.bodies[shot.body], c);
});

test('imán: un pase lento que llega al radio de una chapa se queda pegado a ella', () => {
  const w = new World();
  const ball = w.add(makeBody(KIND.BALL, 0, 0.1));
  const mate = w.add(makeBody(KIND.CAP, 0.0, -0.05, 0));
  ball.vz = -0.75; // pase suave hacia el compañero
  run(w);
  const d = Math.hypot(ball.x - mate.x, ball.z - mate.z) - mate.r - ball.r;
  assert.ok(d < 0.002, `distancia al compañero ${d}`);
  assert.equal(w.owner, mate);
  assert.ok(w.settled());
});

test('imán: un balón rápido pasa de largo sin pegarse', () => {
  const w = new World();
  const ball = w.add(makeBody(KIND.BALL, 0, 0.3));
  w.add(makeBody(KIND.CAP, 0.04, 0.1, 0));
  ball.vz = -2.0;
  for (let t = 0; t < 0.15; t += 1 / 60) w.step(1 / 60);
  assert.ok(ball.z < 0.05, `debe seguir su camino: ${ball.z}`);
});

test('superficies: en arena la chapa recorre bastante menos que en tapete', () => {
  const dist = (mu) => {
    const w = new World();
    w.surf = { mu: { cap: mu, keeper: 1, ball: 1 }, jitter: { cap: 0, keeper: 0, ball: 0 } };
    const c = w.add(makeBody(KIND.CAP, 0, 0.3, 0));
    c.vz = -1.5;
    run(w);
    return 0.3 - c.z;
  };
  const tapete = dist(1), arena = dist(1.75);
  assert.ok(arena < tapete * 0.7, `tapete ${tapete.toFixed(3)} arena ${arena.toFixed(3)}`);
});

test('un golpe muy fuerte en juego a veces levanta el balón; uno suave nunca', () => {
  const maxY = (speed) => {
    let best = 0;
    for (let k = 0; k < 12; k++) {
      const w = new World();
      const ball = w.add(makeBody(KIND.BALL, 0, 0.05));
      const c = w.add(makeBody(KIND.CAP, 0, 0.08, 0));
      c.vz = -speed;
      for (let t = 0; t < 1; t += 1 / 60) { w.step(1 / 60); best = Math.max(best, ball.y); }
    }
    return best;
  };
  assert.equal(maxY(1.2), 0);
  assert.ok(maxY(2.6) > 0.01, 'el tiro a tope debería levantarlo alguna vez');
});

test('portero del rival (automático) para un tiro flojo al centro', () => {
  const w = setupMatch(new World(), 0);
  for (const b of w.bodies) if (b.kind === 'cap') { b.x = (b.x > 0 ? 1 : -1) * 0.25; }
  const ball = w.ball;
  ball.x = 0.05; ball.z = -0.2; ball.vz = -1.2; ball.vx = -0.05;
  run(w);
  assert.equal(w.goal, null, 'debería pararlo');
});

test('tu portero sigue la palanca (tx) y nadie lo empuja', () => {
  const w = setupMatch(new World(), 0);
  const k = w.bodies.find((b) => b.kind === 'keeper' && b.team === 0);
  k.tx = 0.06;
  for (let t = 0; t < 0.3; t += 1 / 60) w.step(1 / 60);
  assert.ok(Math.abs(k.x - 0.06) < 0.002, `x ${k.x}`);
  const z0 = k.z;
  const ball = w.ball; ball.x = 0.06; ball.z = k.z - 0.08; ball.vz = 2.0;
  for (let t = 0; t < 0.5; t += 1 / 60) w.step(1 / 60);
  assert.equal(k.z, z0);
  assert.ok(ball.vz < 0, 'el balón rebota en el portero');
});

test('tirachinas hacia arriba (loft): el balón se eleva', () => {
  const w = new World();
  const ball = w.add(makeBody(KIND.BALL, 0, 0.05));
  const c = w.add(makeBody(KIND.CAP, 0, 0.08, 0));
  c.loft = 0.8; c.vz = -1.6;
  let maxY = 0;
  for (let t = 0; t < 1; t += 1 / 60) { w.step(1 / 60); maxY = Math.max(maxY, ball.y); }
  assert.ok(maxY > 0.02, `altura ${maxY}`);
});
