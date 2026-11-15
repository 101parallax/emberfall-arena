// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between six screens: title, play, level-up, paused, game over and
// victory. Sounds are synthesised, never fetched.
//
// ?seed=N fixes the run's rolls. ?shot=start|play|levelup|end (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady for a
// screenshot.
//
// For play-testing, window.__emberfall exposes the screen, the live state and a small debug
// handle (grant XP, set HP, force a win) — it changes nothing about the game itself.

import { BEST_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  EVENT_BOSS,
  EVENT_HEAL,
  EVENT_HURT,
  EVENT_KILL,
  EVENT_LEVELUP,
  EVENT_NOVA,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_SHOOT,
  EVENT_VICTORY,
  EVENT_WAVE_CLEAR,
  createWorld,
} from './world.js';
import {
  ACTION_CONFIRM,
  ACTION_MUTE,
  ACTION_PAUSE,
  ACTION_PICK_1,
  ACTION_PICK_2,
  ACTION_PICK_3,
  ACTION_RESTART,
  createInput,
} from './input.js';
import { createAudio } from './audio.js';
import {
  SCREEN_LEVELUP,
  SCREEN_OVER,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_TITLE,
  SCREEN_VICTORY,
  createRenderer,
} from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped. */
const MAX_FRAME = 0.25;
/** Minimum gap between repeated one-shot sounds, in milliseconds. */
const SOUND_GAP = 70;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, false);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, (x, y) => renderer.toField(x, y));
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let lastSoundAt = { shoot: 0, kill: 0, pickup: 0 };

  function announce(message) {
    status.textContent = message;
  }

  function playSound(kind, now) {
    if (now - (lastSoundAt[kind] ?? 0) < SOUND_GAP) return;
    lastSoundAt[kind] = now;
    if (kind === 'shoot') audio.shoot();
    else if (kind === 'kill') audio.enemyDie();
    else if (kind === 'pickup') audio.pickup();
  }

  function handleEvents(events, now) {
    if (events & EVENT_SHOOT) playSound('shoot', now);
    if (events & EVENT_KILL) playSound('kill', now);
    if (events & EVENT_PICKUP) playSound('pickup', now);
    if (events & EVENT_HEAL) audio.heal();
    if (events & EVENT_HURT) audio.hurt();
    if (events & EVENT_NOVA) audio.nova();
    if (events & EVENT_WAVE_CLEAR) audio.waveClear();
    if (events & EVENT_BOSS) audio.bossRoar();
    if (events & EVENT_LEVELUP) {
      audio.levelUp();
      screen = SCREEN_LEVELUP;
      announce(`Level ${world.state.level}. Choose a blessing.`);
    }
    if (events & EVENT_VICTORY) endRun(true);
    else if (events & EVENT_OVER) endRun(false);
  }

  function startGame() {
    audio.unlock();
    audio.startDrone();
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Survive 5 waves and slay the Ash Tyrant.');
  }

  function endRun(victory) {
    audio.stopDrone();
    screen = victory ? SCREEN_VICTORY : SCREEN_OVER;
    if (victory) audio.victory();
    else audio.gameOver();
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    announce(
      victory
        ? `Victory. Score ${world.state.score}. Best ${best}.`
        : `Game over. Score ${world.state.score}. Best ${best}.`,
    );
  }

  function chooseUpgrade(index) {
    const choices = world.state.choices ?? [];
    const def = choices[index];
    if (!def) return;
    audio.click();
    world.applyUpgrade(def.id);
    if (world.state.choices) {
      announce(`Level ${world.state.level}. Choose another blessing.`);
    } else {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function clickCard(point) {
    for (const rect of renderer.cardRects) {
      if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
        chooseUpgrade(rect.index);
        return true;
      }
    }
    return false;
  }

  function handleActions() {
    const actions = input.takeActions();
    const click = input.takeClick();
    if (actions & ACTION_MUTE) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame();
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        announce('Paused.');
      } else if (actions & ACTION_RESTART) {
        startGame();
      }
    } else if (screen === SCREEN_LEVELUP) {
      if (click) clickCard(click);
      if (actions & ACTION_PICK_1) chooseUpgrade(0);
      else if (actions & ACTION_PICK_2) chooseUpgrade(1);
      else if (actions & ACTION_PICK_3) chooseUpgrade(2);
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      } else if (actions & ACTION_RESTART) {
        startGame();
      }
    } else if (screen === SCREEN_OVER || screen === SCREEN_VICTORY) {
      if (actions & (ACTION_RESTART | ACTION_CONFIRM)) startGame();
    }
  }

  function step(now) {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { x: 0, y: 0 }, 'title');
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const move = input.move();
    const events = world.step(STEP, move, 'play');
    handleEvents(events, now);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step(now);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen, best, audio.isMuted);
  }

  // Leaving the tab pauses a running game rather than letting foes close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  // A small handle for play-testing: the screen, the live state and a debug lever.
  window.__emberfall = {
    get screen() {
      return screen;
    },
    get state() {
      return world.state;
    },
    start: startGame,
    debug: {
      grantXp(amount) {
        const events = world.grantXp(amount);
        if (events & EVENT_LEVELUP) {
          screen = SCREEN_LEVELUP;
          announce(`Level ${world.state.level}. Choose a blessing.`);
        }
        return events;
      },
      setHp(value) {
        world.state.player.hp = Math.max(0, Math.min(value, world.state.stats.maxHp));
        world.state.player.invulnerable = 0;
      },
      win() {
        world.state.victory = true;
        endRun(true);
      },
    },
  };

  announce('Emberfall, Ashen Arena. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
