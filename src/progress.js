// Progreso del jugador (se guarda en este navegador): victorias, récords y desbloqueos.
// Motivo para volver: empiezas con el garbanzo y el tapete; ganando se abren balones y campos.

export const UNLOCKS = [
  // [qué, clave, condición legible, comprobación]
  { kind: 'ball', key: 'garbanzo', need: 'De serie', ok: () => true },
  { kind: 'surface', key: 'tapete', need: 'De serie', ok: () => true },
  { kind: 'ball', key: 'clasico', need: 'Gana 1 partido', ok: (p) => p.wins >= 1 },
  { kind: 'surface', key: 'cesped', need: 'Gana 1 partido', ok: (p) => p.wins >= 1 },
  { kind: 'surface', key: 'tiza', need: 'Gana 2 partidos', ok: (p) => p.wins >= 2 },
  { kind: 'ball', key: 'mundial', need: 'Gana 3 partidos', ok: (p) => p.wins >= 3 },
  { kind: 'ball', key: 'cuero', need: 'Gana una tanda de penaltis', ok: (p) => p.penWins >= 1 },
  { kind: 'surface', key: 'arena', need: 'Gana en DIFÍCIL', ok: (p) => p.hardWins >= 1 },
];

export const DIFFICULTY = {
  facil: { name: 'FÁCIL', noise: 0.13, keeper: 0.3 },
  normal: { name: 'NORMAL', noise: 0.07, keeper: 0.42 },
  dificil: { name: 'DIFÍCIL', noise: 0.03, keeper: 0.58 },
};

const KEY = 'campioni-progreso';
const base = () => ({ wins: 0, losses: 0, hardWins: 0, penWins: 0, penLosses: 0, goals: 0, bestDiff: 0, streak: 0, bestStreak: 0, tutorialDone: false });

export function loadProgress() {
  try { return { ...base(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return base(); }
}
export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ }
}

export const isUnlocked = (p, kind, key) => UNLOCKS.some((u) => u.kind === kind && u.key === key && u.ok(p));
export const unlockedKeys = (p, kind) => UNLOCKS.filter((u) => u.kind === kind && u.ok(p)).map((u) => u.key);

// Aplica el resultado y devuelve lo que se acaba de desbloquear (para anunciarlo)
export function recordResult(p, { mode, won, diff, goalsFor, goalsAgainst }) {
  const before = new Set(UNLOCKS.filter((u) => u.ok(p)).map((u) => u.kind + u.key));
  if (mode === 'penalties') { if (won) p.penWins++; else p.penLosses++; }
  else {
    p.goals += goalsFor;
    if (won) {
      p.wins++; p.streak++;
      if (diff === 'dificil') p.hardWins++;
      p.bestDiff = Math.max(p.bestDiff, goalsFor - goalsAgainst);
    } else { p.losses++; p.streak = 0; }
    p.bestStreak = Math.max(p.bestStreak, p.streak);
  }
  saveProgress(p);
  return UNLOCKS.filter((u) => u.ok(p) && !before.has(u.kind + u.key));
}
