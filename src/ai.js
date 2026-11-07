// Rival por ordenador: prueba muchos disparos en una copia del mundo y se queda con el mejor.
// Es un generador para poder repartir el cálculo entre fotogramas (en el visor no puede trabarse).
import { KIND } from './physics.js';

const SIM_DT = 1 / 120;
const SIM_MAX = 5; // segundos simulados por candidato

function candidates(world, team) {
  const ball = world.ball;
  const dir = team === 1 ? 1 : -1; // hacia dónde ataca
  const goalZ = dir * (world.f.L / 2 + 0.02);
  const out = [];
  const ownGoalZ = -dir * (world.f.L / 2);
  const ballNearHome = Math.abs(ball.z - ownGoalZ) < 0.2;
  // el portero solo sale si el garbanzo está cerca de casa
  const mine = world.bodies.filter((b) => b.team === team && (b.kind !== KIND.KEEPER || ballNearHome));
  for (const c of mine) {
    // punto "de billar": detrás del garbanzo según la línea garbanzo→portería
    const gx = 0 - ball.x, gz = goalZ - ball.z;
    const gl = Math.hypot(gx, gz) || 1;
    const aims = [];
    for (const off of [-0.05, -0.025, 0, 0.025, 0.05]) {
      const tx = ball.x - (gx / gl) * (ball.r + c.r) * 0.9 + off * (-gz / gl);
      const tz = ball.z - (gz / gl) * (ball.r + c.r) * 0.9 + off * (gx / gl);
      aims.push([tx, tz]);
    }
    aims.push([ball.x, ball.z]);
    for (const [tx, tz] of aims) {
      const ax = tx - c.x, az = tz - c.z;
      const al = Math.hypot(ax, az);
      if (al < 1e-4) continue;
      for (const sp of [0.9, 1.4, 1.9, 2.4]) {
        out.push({ body: world.bodies.indexOf(c), vx: (ax / al) * sp, vz: (az / al) * sp });
      }
    }
  }
  return out;
}

function evaluate(world, team, cand) {
  const w = world.clone();
  const b0 = w.ball;
  const dir = team === 1 ? 1 : -1;
  const startZ = b0.z;
  const body = w.bodies[cand.body];
  body.vx = cand.vx; body.vz = cand.vz;
  w.ballTouched = false;
  let t = 0;
  while (t < SIM_MAX && !w.goal) {
    w.step(SIM_DT, false);
    t += SIM_DT;
    if (w.settled()) break;
  }
  if (w.goal) return w.goal.scorer === team ? 1000 : -1000;
  const b = w.ball;
  const hl = w.f.L / 2;
  let score = (b.z - startZ) * dir * 100; // avance del garbanzo
  const distGoal = Math.hypot(b.x, dir * hl - b.z);
  score -= distGoal * 20;
  const distOwn = Math.hypot(b.x, -dir * hl - b.z);
  if (distOwn < 0.2) score -= (0.2 - distOwn) * 300; // no dejarlo cerca de casa
  if (!w.ballTouched) score -= 15;
  // no dejar la chapa tirada en campo propio lejos de todo
  return score;
}

export function* think(world, team, { noise = 0.06, rng = Math.random } = {}) {
  const cands = candidates(world, team);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const s = evaluate(world, team, cands[i]);
    if (s > bestScore) { bestScore = s; best = cands[i]; }
    yield null; // un candidato por paso
  }
  if (!best) return null;
  // un poco de error humano
  const ang = (rng() - 0.5) * 2 * noise;
  const sp = 1 + (rng() - 0.5) * noise * 1.5;
  const c = Math.cos(ang), s = Math.sin(ang);
  return {
    body: best.body,
    vx: (best.vx * c - best.vz * s) * sp,
    vz: (best.vx * s + best.vz * c) * sp,
    score: bestScore,
  };
}

export function thinkSync(world, team, opts) {
  const g = think(world, team, opts);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

export { KIND };
