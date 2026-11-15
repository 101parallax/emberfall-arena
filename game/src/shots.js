// The screenshot scenes behind ?shot=start|play|levelup|end. Each one plays the real rules
// forward from a fresh world for a fixed number of steps, steered by a simple autopilot
// (flee what is close, chase the nearest ember, drift to the middle when nothing threatens),
// so the frame is what a real game looks like and the same seed always gives the same frame.

import { FIELD, STEP } from './config.js';
import { AUTOPILOT_PRIORITY } from './upgrades.js';
import { EVENT_LEVELUP, EVENT_OVER, EVENT_VICTORY, KIND_BOSS } from './world.js';
import { SCREEN_LEVELUP, SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE, SCREEN_VICTORY } from './render.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 100;
const LEVELUP_LIMIT_SECONDS = 150;
const END_LIMIT_SECONDS = 480;

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
    if (stop(events)) return events;
  }
  return 0;
}

/**
 * Set `world` to the named scene (start, play, levelup or end; any other name is start) and
 * return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'levelup' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, { x: 0, y: 0 }, 'title');
    return { screen: SCREEN_TITLE, best: 0 };
  }
  if (name === 'levelup') {
    let hit = false;
    for (let i = 0; i < LEVELUP_LIMIT_SECONDS / STEP; i += 1) {
      const events = world.step(STEP, autopilotMove(world.state), 'play');
      if (events & EVENT_LEVELUP) {
        hit = true;
        break;
      }
      if (events & (EVENT_OVER | EVENT_VICTORY)) break;
    }
    return { screen: hit ? SCREEN_LEVELUP : SCREEN_PLAY, best: world.state.score };
  }
  if (name === 'end') {
    const events = simulate(world, END_LIMIT_SECONDS / STEP, (e) => (e & (EVENT_OVER | EVENT_VICTORY)) !== 0);
    if (events & EVENT_VICTORY) return { screen: SCREEN_VICTORY, best: world.state.score };
    if (world.state.victory) return { screen: SCREEN_VICTORY, best: world.state.score };
    return { screen: SCREEN_OVER, best: world.state.score };
  }
  simulate(world, PLAY_SECONDS / STEP, () => false);
  return { screen: SCREEN_PLAY, best: world.state.score };
}
