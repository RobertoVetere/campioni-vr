// Física 2D de mesa: chapas, porteros y garbanzo deslizando sobre un tapete.
// Coordenadas en metros sobre el plano de la mesa: x = ancho, z = largo.
// El jugador (equipo 0) defiende la portería de z = +L/2 (la que tiene cerca)
// y ataca hacia z negativo. La CPU (equipo 1) al revés.

export const FIELD = {
  L: 0.9, // largo
  W: 0.56, // ancho
  goalW: 0.16, // boca de la portería
  goalD: 0.05, // fondo de la portería
};

export const G = 9.81;
const STEP = 1 / 240;
const STOP_SPEED = 0.004;

// Bandas de goma: rebotan mucho (las redes de la portería no tanto, ver más abajo)
export const WALL_E = { ball: 0.8, cap: 0.72, keeper: 0.6 };

export const KIND = { CAP: 'cap', KEEPER: 'keeper', BALL: 'ball' };

const PROPS = {
  cap: { r: 0.0135, m: 0.002, mu: 0.34, e: 0.82 },
  keeper: { r: 0.021, m: 0.03, mu: 0.45, e: 0.6 },
  ball: { r: 0.0048, m: 0.0009, mu: 0.16, e: 0.9 },
};

// Tipos de balón (se eligen en el menú). El garbanzo es el original.
export const BALL_TYPES = {
  garbanzo: { name: 'Garbanzo', r: 0.0048, m: 0.0009, mu: 0.16 },
  clasico: { name: 'Balón clásico', r: 0.0065, m: 0.0012, mu: 0.12 },
  mundial: { name: 'Balón Mundial', r: 0.0065, m: 0.0012, mu: 0.11 },
  cuero: { name: 'Cuero histórico', r: 0.0068, m: 0.0016, mu: 0.15 },
};

// Alturas (para saber si el balón por el aire pasa por encima)
export const HEIGHT = { cap: 0.0065, keeper: 0.032 };

// Portero de futbolín: va en una barra y solo se mueve a lo ancho de su portería.
// El tuyo lo mueves tú con la palanca (tx); el del rival lo lleva el ordenador (auto).
export const KEEPER = { range: 0.1, handSpeed: 1.6, autoSpeed: 0.42 };
export const CROSSBAR = 0.035;
const LIFT = 0.55; // con la chapa volteada, parte del golpe se convierte en altura
const HARD_HIT = 2.0; // m/s: por encima, un golpe normal también puede levantar el balón

// Imán de posesión (como en el Subbuteo): un balón lento que entra en el radio de una chapa
// se queda pegado a ella. Así los pases "llegan" y no todo es un rebote en disputa.
export const MAGNET = { reach: 0.03, maxSpeed: 0.38, pull: 260, damp: 22 };

export function makeBody(kind, x, z, team = -1, num = 0) {
  const p = PROPS[kind];
  return { kind, team, num, x, z, y: 0, vx: 0, vz: 0, vy: 0, r: p.r, m: p.m, mu: p.mu, e: p.e, angle: 0, spin: 0, roll: 0, flipped: false };
}

function wallSegments(f) {
  const { L, W, goalW, goalD } = f;
  const hl = L / 2, hw = W / 2, gw = goalW / 2;
  const s = [
    [-hw, -hl, -hw, hl], // lateral izq
    [hw, -hl, hw, hl], // lateral der
  ];
  for (const sz of [1, -1]) {
    const z = sz * hl, zb = sz * (hl + goalD);
    s.push([-hw, z, -gw, z], [gw, z, hw, z]); // fondo a los lados de la portería
    s.push([-gw, z, -gw, zb, 1], [gw, z, gw, zb, 1]); // laterales de la red (no rebotan)
    s.push([-gw, zb, gw, zb, 1]); // fondo de la red
    s.push([-gw, z, gw, z, 2]); // línea de gol: frena las chapas, el garbanzo la cruza
  }
  return s;
}

export class World {
  constructor(field = FIELD) {
    this.f = field;
    this.bodies = [];
    this.walls = wallSegments(field);
    this.ball = null;
    this.goal = null; // {scorer} cuando entra
    this.ballTouched = false;
    this.shotTeam = null; // equipo que acaba de tirar (para pitar faltas)
    this.foul = null; // equipo que ha cometido falta en este tiro
    this.foulAt = null; // dónde fue la falta {x, z}
    this.owner = null; // chapa que tiene el balón pegado
    this.magnet = true;
    this.goalsOn = true;
    // superficie: multiplicadores de rozamiento y "desvío" aleatorio (arena, baches)
    this.surf = { mu: { cap: 1, keeper: 1, ball: 1 }, jitter: { cap: 0, keeper: 0, ball: 0 } };
    this.events = [];
  }

  add(b) {
    this.bodies.push(b);
    if (b.kind === KIND.BALL) this.ball = b;
    return b;
  }

  clone() {
    const w = new World(this.f);
    w.surf = this.surf;
    for (const b of this.bodies) w.add({ ...b });
    return w;
  }

  settled() {
    return this.bodies.every((b) => b.kin || (b.vx === 0 && b.vz === 0 && b.y === 0 && b.vy === 0));
  }

  // Avanza dt segundos. Devuelve los eventos (choques y gol) ocurridos.
  step(dt, collectEvents = true) {
    this.events = [];
    let n = Math.max(1, Math.round(dt / STEP));
    if (n > 12) n = 12;
    for (let i = 0; i < n && !this.goal; i++) {
      // pasos más finos cuando algo va rápido: el garbanzo no puede saltarse una banda
      let maxS = 0;
      for (const b of this.bodies) {
        const s = Math.hypot(b.vx, b.vz) / b.r;
        if (s > maxS) maxS = s;
      }
      const k = Math.min(16, Math.max(1, Math.ceil((maxS * STEP) / 0.4)));
      for (let j = 0; j < k && !this.goal; j++) this.substep(STEP / k, collectEvents);
    }
    return this.events;
  }

  // Seguridad: nada puede quedar fuera del recinto (mesa + porterías)
  contain(b) {
    const { L, W, goalW, goalD } = this.f;
    const hw = W / 2 - b.r, hl = L / 2, gw = goalW / 2 - b.r;
    if (b.x > hw) { b.x = hw; if (b.vx > 0) b.vx = -b.vx * 0.5; }
    if (b.x < -hw) { b.x = -hw; if (b.vx < 0) b.vx = -b.vx * 0.5; }
    const inMouth = b.kind === KIND.BALL && Math.abs(b.x) <= gw; // solo el garbanzo entra en la portería
    const zmax = inMouth ? hl + goalD - b.r : hl - b.r;
    if (Math.abs(b.z) > hl - b.r && !inMouth) {
      // fuera de la boca: o está en el campo o dentro de la red
      if (Math.abs(b.z) > hl) { b.x = Math.sign(b.x) * gw; }
      else { b.z = Math.sign(b.z) * (hl - b.r); if (b.vz * Math.sign(b.z) > 0) b.vz = -b.vz * 0.5; }
    }
    if (Math.abs(b.z) > zmax) { b.z = Math.sign(b.z) * zmax; if (b.vz * Math.sign(b.z) > 0) b.vz = -b.vz * 0.5; }
  }

  substep(h, ev) {
    const B = this.bodies;
    // porteros en su barra (cinemáticos: empujan, pero nada los empuja)
    for (const k of B) {
      if (!k.kin) continue;
      if (k.auto) k.tx = this.autoKeeperTarget(k);
      const want = Math.max(-KEEPER.range, Math.min(KEEPER.range, k.tx ?? k.x));
      const max = (k.auto ? KEEPER.autoSpeed : KEEPER.handSpeed) * h;
      const step = Math.max(-max, Math.min(max, want - k.x));
      k.x += step; k.z = k.homeZ;
      k.vx = Math.abs(step) > 1e-7 ? step / h : 0; k.vz = 0;
    }
    // Rozamiento de Coulomb (tapete) + algo de amortiguación
    for (const b of B) {
      if (b.kin) continue;
      // vuelo del balón (tiro libre con la chapa volteada)
      if (b.y > 0 || b.vy !== 0) {
        b.vy -= G * h;
        b.y += b.vy * h;
        if (b.y <= 0) {
          b.y = 0;
          if (b.vy < -0.2) { b.vy = -b.vy * 0.42; if (this.events && ev) this.events.push({ type: 'bounce', speed: b.vy, a: b }); }
          else b.vy = 0;
        }
      }
      const air = b.y > 0.0005;
      const s = Math.hypot(b.vx, b.vz);
      if (s === 0) { b.spin *= 0.9; continue; }
      const dec = air ? s * 0.08 * h : b.mu * this.surf.mu[b.kind] * G * h + s * 0.15 * h;
      // desvío: la dirección hace un pequeño paseo aleatorio (surcos de arena, baches del cemento)
      const jit = air ? 0 : this.surf.jitter[b.kind];
      if (jit && s > 0.05) {
        const da = (Math.random() - 0.5) * jit * Math.sqrt(h) * 2;
        const c = Math.cos(da), sn = Math.sin(da);
        const vx = b.vx * c - b.vz * sn; b.vz = b.vx * sn + b.vz * c; b.vx = vx;
      }
      if (!air && (s <= dec || s < STOP_SPEED)) { b.vx = 0; b.vz = 0; }
      else { const k = (s - dec) / s; b.vx *= k; b.vz *= k; }
      b.x += b.vx * h;
      b.z += b.vz * h;
      b.roll += (s * h) / b.r;
      b.angle += b.spin * h;
      b.spin *= 1 - 2.5 * h;
    }
    // Choques entre cuerpos
    for (let i = 0; i < B.length; i++) {
      const a = B[i];
      for (let j = i + 1; j < B.length; j++) {
        const b = B[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 === 0) continue;
        // el balón por el aire pasa por encima de lo que sea más bajo que él
        if (a.kind === KIND.BALL && a.y > HEIGHT[b.kind]) continue;
        if (b.kind === KIND.BALL && b.y > HEIGHT[a.kind]) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const ia = a.kin ? 0 : 1 / a.m, ib = b.kin ? 0 : 1 / b.m;
        if (ia + ib === 0) continue;
        // separar
        const pen = rr - d;
        const ca = (pen * ia) / (ia + ib), cb = (pen * ib) / (ia + ib);
        a.x -= nx * ca; a.z -= nz * ca;
        b.x += nx * cb; b.z += nz * cb;
        const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rv >= 0) continue;
        const e = Math.min(a.e, b.e);
        const J = (-(1 + e) * rv) / (ia + ib);
        a.vx -= J * ia * nx; a.vz -= J * ia * nz;
        b.vx += J * ib * nx; b.vz += J * ib * nz;
        // chapa volteada contra el balón: lo levanta según la fuerza del golpe
        if (a.kind === KIND.BALL && b.flipped) a.vy = Math.max(a.vy, -rv * LIFT);
        if (b.kind === KIND.BALL && a.flipped) b.vy = Math.max(b.vy, -rv * LIFT);
        // tiro "por arriba" del tirachinas: cuanto más subiste la mano, más se eleva
        if (a.kind === KIND.BALL && b.loft) a.vy = Math.max(a.vy, -rv * 0.95 * b.loft);
        if (b.kind === KIND.BALL && a.loft) b.vy = Math.max(b.vy, -rv * 0.95 * a.loft);
        // golpe muy fuerte con la chapa normal: a veces el balón se levanta (y puede irse por encima del larguero)
        if (-rv > HARD_HIT && (a.kind === KIND.BALL || b.kind === KIND.BALL) && !a.flipped && !b.flipped && !a.kin && !b.kin) {
          const ball = a.kind === KIND.BALL ? a : b;
          if (ball.y < 0.001) ball.vy = Math.max(ball.vy, (-rv - HARD_HIT) * 1.2 * (0.3 + Math.random() * 1.2));
        }
        // giro visual por la componente tangencial
        const tv = (b.vx - a.vx) * -nz + (b.vz - a.vz) * nx;
        a.spin += (tv * 0.3) / a.r; b.spin -= (tv * 0.3) / b.r;
        if (a.kind === KIND.BALL || b.kind === KIND.BALL) this.ballTouched = true;
        // Falta: tu chapa toca una rival antes de que el garbanzo se haya movido
        else if (a.team !== b.team && this.shotTeam !== null && !this.ballTouched && this.foul === null) {
          this.foul = this.shotTeam;
          this.foulAt = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          if (ev) this.events.push({ type: 'foul', team: this.shotTeam, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
        }
        if (ev) this.events.push({ type: 'hit', speed: -rv, a, b });
      }
    }
    // Choques con las bandas
    for (const b of B) {
      if (b.kin) continue;
      for (const w of this.walls) {
        // la línea de gol frena chapas siempre, y el balón solo si va por encima del larguero
        if (w[4] === 2 && b.kind === KIND.BALL && b.y + b.r < CROSSBAR) continue;
        const [x1, z1, x2, z2] = w;
        const ex = x2 - x1, ez = z2 - z1;
        const len2 = ex * ex + ez * ez;
        let t = ((b.x - x1) * ex + (b.z - z1) * ez) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = x1 + ex * t, pz = z1 + ez * t;
        const dx = b.x - px, dz = b.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= b.r * b.r) continue;
        const d = Math.sqrt(d2) || 1e-9;
        const nx = dx / d, nz = dz / d;
        b.x = px + nx * b.r;
        b.z = pz + nz * b.r;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) {
          const e = w[4] === 1 ? 0.2 : w[4] === 2 ? 0.5 : WALL_E[b.kind];
          b.vx -= (1 + e) * vn * nx;
          b.vz -= (1 + e) * vn * nz;
          if (ev) this.events.push({ type: w[4] === 1 ? 'net' : w[4] === 2 ? 'post' : 'wall', speed: -vn, a: b, x: px, z: pz });
        }
      }
    }
    if (this.magnet) this.applyMagnet(h, ev);
    for (const b of B) this.contain(b);
    // dentro de la portería, el techo de la red
    const bl = this.ball;
    if (bl && Math.abs(bl.z) > this.f.L / 2 && bl.y + bl.r > CROSSBAR) { bl.y = CROSSBAR - bl.r; if (bl.vy > 0) bl.vy = -bl.vy * 0.3; }
    // ¿Gol? El garbanzo tiene que cruzar entero la línea
    const ball = this.ball;
    if (ball && this.goalsOn && !this.goal && Math.abs(ball.x) < this.f.goalW / 2) {
      const hl = this.f.L / 2;
      if (ball.z > hl + ball.r) this.goal = { scorer: 1 }; // en la portería del jugador
      else if (ball.z < -hl - ball.r) this.goal = { scorer: 0 };
      if (this.goal && ev) this.events.push({ type: 'goal', scorer: this.goal.scorer });
    }
  }

  // portero del ordenador: se coloca donde va a llegar el balón (con su velocidad limitada)
  autoKeeperTarget(k) {
    const ball = this.ball;
    if (!ball) return 0;
    const towards = Math.sign(k.homeZ) * ball.vz > 0.15;
    if (towards) {
      const t = (k.homeZ - ball.z) / ball.vz;
      if (t > 0 && t < 2) return ball.x + ball.vx * t;
    }
    return ball.x * 0.45;
  }

  applyMagnet(h, ev) {
    const ball = this.ball;
    if (!ball || ball.y > 0.001) return;
    const sp = Math.hypot(ball.vx, ball.vz);
    if (sp > MAGNET.maxSpeed) { if (sp > MAGNET.maxSpeed * 1.5) this.owner = null; return; }
    let best = null, bd = MAGNET.reach;
    for (const c of this.bodies) {
      // el portero de barra no "atrapa" (si no, el balón le persigue y él al balón, sin fin)
      if (c === ball || c.flipped || c.kin) continue;
      const reach = c.kind === 'keeper' ? MAGNET.reach * 0.6 : MAGNET.reach;
      const d = Math.hypot(ball.x - c.x, ball.z - c.z) - c.r - ball.r;
      if (d < reach && d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    // punto de contacto en el lado donde está el balón
    const dx = ball.x - best.x, dz = ball.z - best.z, dl = Math.hypot(dx, dz) || 1;
    const tx = best.x + (dx / dl) * (best.r + ball.r + 0.0005), tz = best.z + (dz / dl) * (best.r + ball.r + 0.0005);
    const dist = Math.hypot(tx - ball.x, tz - ball.z);
    if (sp < 0.12) {
      // ya casi parado: se acerca sin velocidad (sin rodar) y se queda quieto pegado.
      // Antes el imán y el rozamiento se peleaban y el balón no paraba nunca de girar despacito.
      const step = Math.min(dist, 0.08 * h);
      if (dist > 1e-6) { ball.x += ((tx - ball.x) / dist) * step; ball.z += ((tz - ball.z) / dist) * step; }
      ball.vx = 0; ball.vz = 0;
    } else {
      ball.vx += ((tx - ball.x) * MAGNET.pull - ball.vx * MAGNET.damp) * h;
      ball.vz += ((tz - ball.z) * MAGNET.pull - ball.vz * MAGNET.damp) * h;
    }
    if (this.owner !== best) { this.owner = best; if (ev) this.events.push({ type: 'control', a: best }); }
  }

  stopAll() {
    for (const b of this.bodies) { b.vx = 0; b.vz = 0; b.vy = 0; b.y = 0; }
  }
}

// Alineación inicial: 4 chapas + portero por equipo. kickoff = equipo que saca.
export function setupMatch(world, kickoff = 0, ballType = 'garbanzo') {
  world.bodies = [];
  world.ball = null;
  world.goal = null;
  world.foul = null;
  world.foulAt = null;
  world.owner = null;
  world.shotTeam = null;
  world.ballTouched = false;
  const hl = world.f.L / 2;
  for (const team of [0, 1]) {
    const s = team === 0 ? 1 : -1; // el jugador está en z > 0
    const k = world.add(makeBody(KIND.KEEPER, 0, s * (hl - 0.03), team, 1));
    k.kin = true; k.homeZ = k.z; k.tx = 0; k.auto = team === 1;
    const pos = [
      [-0.13, 0.27], [0.13, 0.27], // defensas
      [-0.09, 0.11], [0.09, 0.11], // delanteros
    ];
    pos.forEach(([x, z], i) => world.add(makeBody(KIND.CAP, x, s * z, team, i + 2)));
    if (team === kickoff) {
      // el que saca pone una chapa junto al garbanzo
      const last = world.bodies[world.bodies.length - 1];
      last.x = 0.0; last.z = s * 0.035;
    }
  }
  const ball = makeBody(KIND.BALL, 0, 0);
  const bt = BALL_TYPES[ballType] || BALL_TYPES.garbanzo;
  ball.r = bt.r; ball.m = bt.m; ball.mu = bt.mu; ball.type = ballType in BALL_TYPES ? ballType : 'garbanzo';
  world.add(ball);
  return world;
}

export const MAX_SHOT = 2.6; // m/s

export function shoot(body, vx, vz) {
  const s = Math.hypot(vx, vz);
  const k = s > MAX_SHOT ? MAX_SHOT / s : 1;
  body.vx = vx * k;
  body.vz = vz * k;
  body.spin += (Math.random() - 0.5) * 20;
}
