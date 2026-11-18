// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between six screens: title, play, level-up, paused, game over and
// victory. Sounds are synthesised, never fetched.
//
// What the game is, in one paragraph: a top-down arena survivor in seven waves. The Ember
// Warden's bolts fire on their own at the nearest foe; the player steers, dodges and
// gathers. Its one hook is Kindled Ground — every bolt sets the floor alight, and the fire
// burns foes, spreads as they run, and can be grown by the Wildfire blessing, so the fight
// is about herding the horde through the flames as much as shooting it. Five foe kinds
// (mite, brute, spitter, dasher, splitter), a Tyrantling mini-boss on wave 4, and the Ash
// Tyrant on wave 7 — bigger now, and raging into a second phase at half health; nine
// stackable blessings; six relics carried from fallen champions; three trials to choose
// from on a living title screen, with the arena burning behind the panel.
//
// ?seed=N fixes the run's rolls. ?shot=start|play|levelup|end (with &seed=N) stages that
// scene instead of running the loop, paints it twice and sets window.__shotReady for a
// screenshot. ?shot=play stages the Ash Tyrant fight itself.
//
// For play-testing, window.__emberfall exposes the screen, the live state and a small debug
// handle (grant XP, set HP, force a win) — it changes nothing about the game itself.

import { DEFAULT_DIFFICULTY, DIFFICULTY, DIFFICULTY_ORDER, STEP } from './config.js';
import { computeGrade, readBest, recordRun, saveBest } from './save.js';
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

function runShot(name) {
  const scene = stageShot(name, world, () => createWorld(createRandom(seed)));
  const staged = scene.world ?? world;
  let painted = 0;
  function paint() {
    renderer.draw(staged.state, scene.screen, scene.best, false);
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
  let difficulty = DEFAULT_DIFFICULTY;
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

  /** Choose the trial the next run plays on (title screen, keys 1/2/3 or a click). */
  function setDifficulty(id) {
    if (!DIFFICULTY[id] || id === difficulty) return;
    difficulty = id;
    world.setDifficulty(id);
    audio.click();
    announce(`Trial: ${DIFFICULTY[id].name}.`);
  }

  function startGame() {
    audio.unlock();
    audio.startDrone();
    world.setDifficulty(difficulty);
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Survive 7 waves and slay the Ash Tyrant.');
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
    // The run joins the record before the end screen paints, so the last-runs list
    // on the victory screen already includes the run just finished.
    const grade = computeGrade({
      victory,
      time: world.state.elapsed,
      damageTaken: world.state.damageTaken,
      wave: world.state.wave,
    });
    recordRun({
      score: world.state.score,
      kills: world.state.kills,
      time: Math.round(world.state.elapsed),
      level: world.state.level,
      relics: world.state.relics.length,
      victory,
      grade,
    });
    announce(
      victory
        ? `Victory. Score ${world.state.score}. Grade ${grade}. Best ${best}.`
        : `Game over. Score ${world.state.score}. Grade ${grade}. Best ${best}.`,
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

  /** A click on a title-screen difficulty button chooses that trial (and stays put). */
  function clickDifficulty(point) {
    for (const rect of renderer.difficultyRects) {
      if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
        setDifficulty(DIFFICULTY_ORDER[rect.index]);
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
      if (actions & ACTION_PICK_1) setDifficulty(DIFFICULTY_ORDER[0]);
      else if (actions & ACTION_PICK_2) setDifficulty(DIFFICULTY_ORDER[1]);
      else if (actions & ACTION_PICK_3) setDifficulty(DIFFICULTY_ORDER[2]);
      // A click on a difficulty button chooses the trial instead of starting the
      // game — the click also raises ACTION_CONFIRM, which is swallowed here.
      if (click && clickDifficulty(click)) {
        // Chosen; stay on the title screen.
      } else if (actions & ACTION_CONFIRM) startGame();
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
    get difficulty() {
      return difficulty;
    },
    start: startGame,
    debug: {
      grantRelic() {
        return world.grantRelic();
      },
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
