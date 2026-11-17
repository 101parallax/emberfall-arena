// The screenshot scenes behind ?shot=start|play|levelup|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot
// (flee what is close, chase the nearest ember, drift to the middle when nothing threatens),
// so the frame is what a real game looks like and the same seed always gives the same frame.
//
// The scenes are staged for what the frame must show, not for the earliest moment it can
// show it: `play` is the Ash Tyrant fight (the boss alive, its bar up, its minions around
// it, ground-fire burning), and `levelup` is the third blessing choice, when the HUD already
// shows a build in progress.

import { FIELD, STEP } from './config.js';
import { AUTOPILOT_PRIORITY } from './upgrades.js';
import { EVENT_BOSS, EVENT_LEVELUP, EVENT_OVER, EVENT_VICTORY, KIND_BOSS } from './world.js';
import { SCREEN_LEVELUP, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';

const START_SECONDS = 10;
const LEVELUP_LIMIT_SECONDS = 240;
const END_LIMIT_SECONDS = 600;
/** How long the play scene may run before giving up on the boss (a lost run shows as-is). */
const PLAY_LIMIT_SECONDS = 480;
/** Seconds of boss fight the first staging pass watches while it looks for the best frame. */
const BOSS_WATCH_SECONDS = 20;
/** Which level-up the levelup scene stops at (the 3rd choice, around level 4). */
const LEVELUP_STOP_COUNT = 3;

/** How the autopilot steers: flee foes inside this range, chase embers inside this one. */
const FLEE_RANGE = 150;
const CHASE_RANGE = 280;

/**
 * A steering vector for one step: away from close foes (the Tyrant counts double), toward
 * the nearest ember, and back toward the middle when the arena is quiet.
 */
export function autopilotMove(state) {
  const p = state.player;
  let fx = 0;
  let fy = 0;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < FLEE_RANGE) {
      const weight = (e.kind === KIND_BOSS ? 2.4 : 1) * (1 - d / FLEE_RANGE);
      fx += (dx / d) * weight;
      fy += (dy / d) * weight;
    }
  }
  let gem = null;
  let gemD = Infinity;
  for (const g of state.gems) {
    if (!g.active || g.kind !== 'ember') continue;
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d < CHASE_RANGE && d < gemD) {
      gemD = d;
      gem = g;
    }
  }
  if (gem) {
    const d = gemD || 1;
    const weight = 0.9 * (1 - d / CHASE_RANGE) + 0.25;
    fx += ((gem.x - p.x) / d) * weight;
    fy += ((gem.y - p.y) / d) * weight;
  }
  if (fx === 0 && fy === 0) {
    const dx = FIELD.width / 2 - p.x;
    const dy = FIELD.height / 2 - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 60) {
      fx = dx / d;
      fy = dy / d;
    }
  }
  const len = Math.hypot(fx, fy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: fx / len, y: fy / len };
}

/** Pick the best offered blessing by the autopilot's priority list. */
export function autopilotPick(state) {
  const choices = state.choices ?? [];
  for (const id of AUTOPILOT_PRIORITY) {
    const found = choices.find((def) => def.id === id);
    if (found) return found.id;
  }
  return choices.length > 0 ? choices[0].id : null;
}

/** Step the world with the autopilot until `stop` says so, or the step budget runs out. */
function simulate(world, maxSteps, stop) {
  for (let i = 0; i < maxSteps; i += 1) {
    const events = world.step(STEP, autopilotMove(world.state), 'play');
    if (events & EVENT_LEVELUP) {
      const pick = autopilotPick(world.state);
      if (pick) world.applyUpgrade(pick);
    }
    if (stop(events, i)) return events;
  }
  return 0;
}

/** The live Ash Tyrant, or null when the boss fight is not on. */
function liveBoss(state) {
  for (const e of state.enemies) {
    if (e.active && e.kind === KIND_BOSS) return e;
  }
  return null;
}

/** How busy the boss fight looks on one step: foes first, a telegraphing Tyrant next. */
function bossFrameScore(state) {
  const boss = liveBoss(state);
  if (!boss) return -1;
  let foes = 0;
  for (const e of state.enemies) if (e.active) foes += 1;
  const telegraph = boss.mode === 'telegraph' ? 30 : boss.mode === 'charge' ? 15 : 0;
  return foes * 10 + telegraph + state.fire.activeCount() * 0.5;
}

/**
 * Stage the boss fight in two passes over the same deterministic run. The first pass
 * plays forward until the Ash Tyrant wakes, then watches the fight and remembers the
 * step that looks busiest — most foes on screen, the Tyrant telegraphing its charge,
 * ground-fire burning under it all. The second pass replays the same run from the top
 * and stops exactly on that step, so the frame is a real moment of a real fight, not a
 * posed one. Both passes start from fresh worlds built by `freshWorld` (same seed),
 * because a reset world would continue a spent random stream and replay a different run.
 * Returns the world holding the staged frame, or the first pass's world when the warden
 * falls before the boss wakes.
 */
function stageBossFight(freshWorld) {
  const first = freshWorld();
  let bossSeenAt = -1;
  let bestStep = -1;
  let bestScore = -1;
  simulate(first, PLAY_LIMIT_SECONDS / STEP, (ev, i) => {
    if (bossSeenAt < 0 && (ev & EVENT_BOSS)) bossSeenAt = i;
    if (bossSeenAt >= 0) {
      const score = bossFrameScore(first.state);
      if (score >= bestScore) {
        bestScore = score;
        bestStep = i;
      }
      if (i - bossSeenAt >= BOSS_WATCH_SECONDS / STEP) return true;
    }
    if (ev & (EVENT_OVER | EVENT_VICTORY)) return true;
    return false;
  });
  if (bestStep < 0) return first;
  // Second pass: the same run, the same seed — stop on the busiest boss-fight step.
  const second = freshWorld();
  simulate(second, bestStep + 1, () => false);
  return second;
}

/**
 * Set `world` to the named scene (start, play, levelup or end; any other name is start) and
 * return the screen to draw over it, the best score to show, and the world holding the
 * staged frame (`world` itself for every scene except `play`, whose two-pass staging
 * builds its own fresh worlds — see stageBossFight). `freshWorld` must build a new world
 * from the same seed; it is only used for `play`.
 */
export function stageShot(name, world, freshWorld) {
  if (name === 'play' && typeof freshWorld === 'function') {
    const staged = stageBossFight(freshWorld);
    return { screen: SCREEN_PLAY, best: staged.state.score, world: staged };
  }
  world.reset();
  if (name !== 'play' && name !== 'levelup' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, { x: 0, y: 0 }, 'title');
    return { screen: SCREEN_TITLE, best: 0, world };
  }
  if (name === 'levelup') {
    // Wait for the third level-up, so the frame shows a mid-run build: wave 3 or so, a
    // score in the hundreds, and blessing chips already owned. Earlier level-ups are
    // spent on the autopilot's picks, like a real player choosing as they go.
    let seen = 0;
    let hit = false;
    for (let i = 0; i < LEVELUP_LIMIT_SECONDS / STEP; i += 1) {
      const events = world.step(STEP, autopilotMove(world.state), 'play');
      if (events & EVENT_LEVELUP) {
        seen += 1;
        if (seen >= LEVELUP_STOP_COUNT) {
          hit = true;
          break;
        }
        const pick = autopilotPick(world.state);
        if (pick) world.applyUpgrade(pick);
      }
      if (events & (EVENT_OVER | EVENT_VICTORY)) break;
    }
    return { screen: hit ? SCREEN_LEVELUP : SCREEN_PLAY, best: world.state.score, world };
  }
  if (name === 'end') {
    const events = simulate(world, END_LIMIT_SECONDS / STEP, (e) => (e & (EVENT_OVER | EVENT_VICTORY)) !== 0);
    if (events & EVENT_VICTORY) return { screen: SCREEN_VICTORY, best: world.state.score, world };
    if (world.state.victory) return { screen: SCREEN_VICTORY, best: world.state.score, world };
    return { screen: SCREEN_OVER, best: world.state.score, world };
  }
  // No fresh-world factory: fall back to a fixed-length run (the factory path above is
  // the one the game itself uses).
  simulate(world, PLAY_LIMIT_SECONDS / STEP, () => false);
  return { screen: SCREEN_PLAY, best: world.state.score, world };
}
