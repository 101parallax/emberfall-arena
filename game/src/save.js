// What a run leaves behind: the best score, the last three runs, the grade a run earns
// and the feats it completes. Everything lives in this browser's local storage, guarded
// by try/catch like the old best-score read — storage can be off (a private window), and
// a run that cannot be recorded is still a run worth playing.
//
// A run record is small on purpose: score, kills, time, level, relics carried, whether
// the Tyrant fell, and the grade. No dates are stored — the title and victory screens
// show only what is shown here, so a staged screenshot never depends on the clock.
//
// THE GRADE, documented where it is decided (computeGrade):
//   S — victory in under 3:30, with less than 250 damage taken. A clean, fast slaying.
//   A — victory in under 4:30, with less than 500 damage taken.
//   B — any other victory. The Tyrant fell; that is enough.
//   C — defeat on wave 5 or later. The warden reached the deep waves.
//   D — defeat before wave 5. The ash was quicker.
//
// THE FEATS (computeFeats) are six checks against statistics the world tracks through
// the run: slaying the Tyrant, finishing above half health, reaching level 12, burning
// foes with Kindled Ground, never falling below 25 HP, and carrying four relics.

import { BEST_KEY, RUNS_KEY } from './config.js';

/** How many past runs the title and victory screens remember. */
export const LAST_RUNS_COUNT = 3;

// Grade thresholds, in seconds and in damage taken — see the header for what they mean.
export const GRADE_S_TIME = 210;
export const GRADE_S_DAMAGE = 250;
export const GRADE_A_TIME = 270;
export const GRADE_A_DAMAGE = 500;
export const GRADE_C_WAVE = 5;

// Feat thresholds — see the header for the six feats.
export const FEAT_LEVEL = 12;
export const FEAT_BURNED = 40;
export const FEAT_LOWEST_HP = 25;
export const FEAT_RELICS = 4;

/** The colour each grade is drawn in on the victory screen. */
export const GRADE_COLORS = {
  S: '#ffd76a',
  A: '#ffb347',
  B: '#f5ead9',
  C: '#c4b4a4',
  D: '#8a7a84',
};

export function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

/** The last runs, newest first — an empty list when nothing is recorded yet. */
export function readRuns() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RUNS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (run) => run && typeof run.score === 'number' && typeof run.grade === 'string',
    ).slice(0, LAST_RUNS_COUNT);
  } catch {
    return [];
  }
}

/** Record one finished run at the head of the list, keeping only the last few. */
export function recordRun(run) {
  try {
    const runs = readRuns();
    runs.unshift({
      score: run.score,
      kills: run.kills,
      time: run.time,
      level: run.level,
      relics: run.relics,
      victory: !!run.victory,
      grade: run.grade,
    });
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(runs.slice(0, LAST_RUNS_COUNT)));
  } catch {
    // Storage can be off: the run is still over, it just leaves no record.
  }
}

/**
 * The grade for a finished run, from whether the Tyrant fell, how long the run took,
 * how much damage the warden took, and — for a defeat — how far the warden got.
 */
export function computeGrade(summary) {
  if (summary.victory) {
    if (summary.time <= GRADE_S_TIME && summary.damageTaken <= GRADE_S_DAMAGE) return 'S';
    if (summary.time <= GRADE_A_TIME && summary.damageTaken <= GRADE_A_DAMAGE) return 'A';
    return 'B';
  }
  return summary.wave >= GRADE_C_WAVE ? 'C' : 'D';
}

/**
 * The six feats, each with its name and whether this run completed it. The statistics
 * come straight from the world's state: victory, the warden's health at the end, the
 * level reached, foes the fire finished, the lowest health the run ever saw, and the
 * relics carried.
 */
export function computeFeats(state) {
  const halfHp = state.stats.maxHp / 2;
  return [
    { name: 'Slay the Ash Tyrant', done: !!state.victory },
    { name: 'Finish above half health', done: state.player.hp > halfHp },
    { name: `Reach level ${FEAT_LEVEL}`, done: state.level >= FEAT_LEVEL },
    { name: `Burn ${FEAT_BURNED} foes`, done: state.foesBurned >= FEAT_BURNED },
    { name: `Never fall below ${FEAT_LOWEST_HP} HP`, done: state.lowestHp >= FEAT_LOWEST_HP },
    { name: `Collect ${FEAT_RELICS} relics`, done: state.relics.length >= FEAT_RELICS },
  ];
}
