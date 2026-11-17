// The game's rules and state, with no drawing and no browser in it: the warden, the ember
// bolts, five kinds of ash-foe plus the Tyrantling and the Ash Tyrant, seven waves, ember
// XP, level-up choices and the win and loss — and Kindled Ground, the fire the warden's
// bolts leave on the floor (see groundfire.js), which burns foes and spreads as they run.
// step() advances one fixed step and returns what happened as bit flags, so the caller can
// react (sounds, screens) without the world knowing about screens or sound. Nothing here
// allocates after createWorld returns, and nothing uses Math.random: the seeded generator
// drives every roll, so a fixed seed replays the same run.

import {
  BETWEEN_WAVE_HEAL,
  BETWEEN_WAVE_SECONDS,
  ENEMY,
  FIELD,
  GROUNDFIRE,
  HEART_CHANCE,
  HEART_HEAL,
  LAST_WAVE,
  PLAYER,
  POOLS,
  TITLE_FIRE_SECONDS,
  TITLE_FOES,
  TITLE_SPAWN_RATE,
  WAVES,
  xpForLevel,
} from './config.js';
import { findUpgrade, rollChoices } from './upgrades.js';
import { createGroundFire } from './groundfire.js';

export const KIND_MITE = 'mite';
export const KIND_BRUTE = 'brute';
export const KIND_SPITTER = 'spitter';
export const KIND_DASHER = 'dasher';
export const KIND_SPLITTER = 'splitter';
export const KIND_TYRANTLING = 'tyrantling';
export const KIND_BOSS = 'boss';

/** The two big foes that get a health bar across the top of the screen. */
export const BOSS_KINDS = [KIND_TYRANTLING, KIND_BOSS];

export const EVENT_SHOOT = 1;
export const EVENT_KILL = 2;
export const EVENT_PICKUP = 4;
export const EVENT_HEAL = 8;
export const EVENT_HURT = 16;
export const EVENT_LEVELUP = 32;
export const EVENT_WAVE_CLEAR = 64;
export const EVENT_BOSS = 128;
export const EVENT_VICTORY = 256;
export const EVENT_OVER = 512;
export const EVENT_NOVA = 1024;

const TAU = Math.PI * 2;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function createWorld(random) {
  const player = {
    x: FIELD.width / 2, y: FIELD.height / 2, hp: PLAYER.maxHp,
    invulnerable: 0, hurtFlash: 0, fireTimer: 0.3, aimX: 1, aimY: 0,
  };
  const stats = freshStats();
  const enemies = [];
  for (let i = 0; i < POOLS.enemies; i += 1) {
    enemies.push({
      active: false, kind: KIND_MITE, x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: 1,
      radius: 10, speed: 100, contact: 5, xp: 1, score: 0, touchTimer: 0,
      shotTimer: 0, orbTimer: 0, flash: 0, mode: 'chase', modeTimer: 0,
      chargeX: 0, chargeY: 0, wanderX: 0, wanderY: 0, wanderTimer: 0, spawnTimer: 0,
      // Kindled Ground: burnTimer counts down while a foe is alight, burnTick gathers
      // the time toward the next burn-damage tick, spreadTimer paces the fire it trails.
      burnTimer: 0, burnTick: 0, spreadTimer: 0,
    });
  }
  const bolts = [];
  for (let i = 0; i < POOLS.bolts; i += 1) {
    bolts.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, pierce: 0 });
  }
  const gems = [];
  for (let i = 0; i < POOLS.gems; i += 1) {
    gems.push({ active: false, kind: 'ember', x: 0, y: 0, vx: 0, vy: 0, value: 0 });
  }
  const ebullets = [];
  for (let i = 0; i < POOLS.ebullets; i += 1) {
    ebullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 0, radius: 7 });
  }
  const particles = [];
  for (let i = 0; i < POOLS.particles; i += 1) {
    particles.push({
      active: false, kind: 'spark', x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 2, color: '#ffb347', maxRadius: 0,
    });
  }
  const numbers = [];
  for (let i = 0; i < POOLS.numbers; i += 1) {
    numbers.push({ active: false, x: 0, y: 0, value: 0, life: 0, color: '#fff3c4' });
  }

  // The ground-fire system: pooled patches the warden's bolts kindle (groundfire.js).
  const fire = createGroundFire();
  const state = {
    player, stats, enemies, bolts, gems, ebullets, particles, numbers, fire,
    decor: { ruins: [], cracks: [], motes: [] },
    wave: 0, waveState: 'banner', stateTimer: 0, spawnQueue: [], spawnTimer: 0,
    elapsed: 0, score: 0, kills: 0, level: 1, xp: 0, xpNext: xpForLevel(1),
    choices: null, pendingLevels: 0, taken: {}, victory: false, over: false,
    novaTimer: 6, orbAngle: 0, shake: 0, bossActive: false, titleFireTimer: 0,
  };

  function freshStats() {
    return {
      boltDamage: PLAYER.boltDamage,
      fireInterval: PLAYER.fireInterval,
      boltSpeed: PLAYER.boltSpeed,
      projectiles: PLAYER.projectiles,
      speed: PLAYER.speed,
      maxHp: PLAYER.maxHp,
      pickupRadius: PLAYER.pickupRadius,
      novaLevel: 0, novaDamage: 0, novaRadius: 120, novaInterval: 6,
      orbs: 0, orbDamage: 10, orbRadius: 74,
      // Kindled Ground multipliers, grown by the Wildfire blessing.
      fireRadius: 1, fireDamage: 1, fireDuration: 1,
    };
  }

  function free(pool) {
    for (let i = 0; i < pool.length; i += 1) if (!pool[i].active) return pool[i];
    return null;
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      const p = free(particles);
      if (!p) return;
      const angle = random() * TAU;
      const v = speed * (0.3 + random() * 0.7);
      p.active = true;
      p.kind = 'spark';
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = 0.35 + random() * 0.4;
      p.life = p.maxLife;
      p.size = 2 + random() * 3;
      p.color = color;
    }
  }

  function ring(x, y, color, maxRadius) {
    const p = free(particles);
    if (!p) return;
    p.active = true;
    p.kind = 'ring';
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = 0.45;
    p.life = p.maxLife;
    p.size = 4;
    p.color = color;
    p.maxRadius = maxRadius;
  }

  function damageNumber(x, y, value, color) {
    const n = free(numbers);
    if (!n) return;
    n.active = true;
    n.x = x + (random() - 0.5) * 14;
    n.y = y - 8;
    n.value = value;
    n.life = 0.8;
    n.color = color;
  }

  function spawnGem(x, y, kind, value) {
    const g = free(gems);
    if (!g) return;
    const angle = random() * TAU;
    g.active = true;
    g.kind = kind;
    g.x = x;
    g.y = y;
    g.vx = Math.cos(angle) * 40;
    g.vy = Math.sin(angle) * 40;
    g.value = value;
  }

  function edgePoint(minPlayerDist) {
    for (let tries = 0; tries < 12; tries += 1) {
      const side = Math.floor(random() * 4);
      let x = 0;
      let y = 0;
      if (side === 0) { x = 30 + random() * (FIELD.width - 60); y = 30; }
      else if (side === 1) { x = 30 + random() * (FIELD.width - 60); y = FIELD.height - 30; }
      else if (side === 2) { x = 30; y = 30 + random() * (FIELD.height - 60); }
      else { x = FIELD.width - 30; y = 30 + random() * (FIELD.height - 60); }
      if (dist2(x, y, player.x, player.y) >= minPlayerDist * minPlayerDist) return { x, y };
    }
    return { x: 40, y: 40 };
  }

  function spawnEnemy(kind) {
    const e = free(enemies);
    if (!e) return null;
    const def = ENEMY[kind];
    const at = edgePoint(BOSS_KINDS.includes(kind) ? 420 : 300);
    e.active = true;
    e.kind = kind;
    e.x = at.x;
    e.y = at.y;
    e.vx = 0;
    e.vy = 0;
    e.hp = def.hp;
    e.maxHp = def.hp;
    e.radius = def.radius;
    e.speed = def.speed;
    e.contact = def.contact;
    e.xp = def.xp;
    e.score = def.score;
    e.touchTimer = 0;
    e.shotTimer = 1 + random() * 1.5;
    e.orbTimer = 0;
    e.flash = 0;
    e.mode = 'chase';
    e.modeTimer = def.chargeInterval ?? def.dashCooldown ?? 0;
    e.spawnTimer = def.spawnInterval ?? 0;
    e.wanderX = at.x;
    e.wanderY = at.y;
    e.wanderTimer = 0;
    e.burnTimer = 0;
    e.burnTick = 0;
    e.spreadTimer = 0;
    if (BOSS_KINDS.includes(kind)) state.bossActive = true;
    return e;
  }

  /**
   * Spawn a foe at an exact spot instead of the arena's edge: splitter children burst
   * out of their parent, and the Tyrant's minions crawl out of the ground beside it.
   */
  function spawnEnemyAt(kind, x, y) {
    const e = spawnEnemy(kind);
    if (!e) return null;
    e.x = Math.min(FIELD.width - e.radius, Math.max(e.radius, x));
    e.y = Math.min(FIELD.height - e.radius, Math.max(e.radius, y));
    return e;
  }

  function startWave(n) {
    const wave = WAVES[n - 1];
    state.wave = n;
    state.waveState = 'banner';
    state.stateTimer = 2.2;
    state.spawnQueue = [];
    for (let i = 0; i < wave.mites; i += 1) state.spawnQueue.push(KIND_MITE);
    for (let i = 0; i < wave.brutes; i += 1) state.spawnQueue.push(KIND_BRUTE);
    for (let i = 0; i < wave.spitters; i += 1) state.spawnQueue.push(KIND_SPITTER);
    for (let i = 0; i < wave.dashers; i += 1) state.spawnQueue.push(KIND_DASHER);
    for (let i = 0; i < wave.splitters; i += 1) state.spawnQueue.push(KIND_SPLITTER);
    // Shuffle the queue; a big foe always comes last.
    for (let i = state.spawnQueue.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = state.spawnQueue[i];
      state.spawnQueue[i] = state.spawnQueue[j];
      state.spawnQueue[j] = tmp;
    }
    if (wave.miniboss) state.spawnQueue.push(KIND_TYRANTLING);
    if (wave.boss) {
      // The Tyrant does not wait for the last straggler: it wakes a little past the
      // middle of the queue, so its minions keep pouring in around the boss fight
      // instead of the arena standing empty while the warden duels it alone.
      const at = Math.floor(state.spawnQueue.length * 0.55);
      state.spawnQueue.splice(at, 0, KIND_BOSS);
    }
    state.spawnTimer = 0.6;
  }

  function buildDecor() {
    const ruins = [];
    for (let i = 0; i < 7; i += 1) {
      const w = 50 + random() * 90;
      const h = 34 + random() * 60;
      const x = 60 + random() * (FIELD.width - 120 - w);
      const y = 60 + random() * (FIELD.height - 120 - h);
      if (dist2(x + w / 2, y + h / 2, FIELD.width / 2, FIELD.height / 2) < 220 * 220) continue;
      ruins.push({ x, y, w, h, broken: random() < 0.6 });
    }
    const cracks = [];
    for (let i = 0; i < 5; i += 1) {
      const points = [];
      let x = 80 + random() * (FIELD.width - 160);
      let y = 80 + random() * (FIELD.height - 160);
      points.push({ x, y });
      const segments = 3 + Math.floor(random() * 3);
      for (let s = 0; s < segments; s += 1) {
        x += (random() - 0.5) * 180;
        y += (random() - 0.5) * 120;
        points.push({ x, y });
      }
      cracks.push(points);
    }
    const motes = [];
    for (let i = 0; i < 46; i += 1) {
      motes.push({
        x: random() * FIELD.width, y: random() * FIELD.height,
        r: 1 + random() * 2.2, phase: random() * TAU, speed: 6 + random() * 14,
      });
    }
    state.decor = { ruins, cracks, motes };
  }

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2;
    player.hp = PLAYER.maxHp;
    player.invulnerable = 0;
    player.hurtFlash = 0;
    player.fireTimer = 0.3;
    player.aimX = 1;
    player.aimY = 0;
    Object.assign(stats, freshStats());
    for (const e of enemies) e.active = false;
    for (const b of bolts) b.active = false;
    for (const g of gems) g.active = false;
    for (const b of ebullets) b.active = false;
    for (const p of particles) p.active = false;
    for (const n of numbers) n.active = false;
    fire.reset();
    state.elapsed = 0;
    state.score = 0;
    state.kills = 0;
    state.level = 1;
    state.xp = 0;
    state.xpNext = xpForLevel(1);
    state.choices = null;
    state.pendingLevels = 0;
    state.taken = {};
    state.victory = false;
    state.over = false;
    state.novaTimer = 6;
    state.orbAngle = 0;
    state.shake = 0;
    state.bossActive = false;
    state.titleFireTimer = 0;
    buildDecor();
    startWave(1);
  }

  function nearestEnemy() {
    let best = null;
    let bestD = Infinity;
    for (const e of enemies) {
      if (!e.active) continue;
      const d = dist2(e.x, e.y, player.x, player.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function damageEnemy(e, amount, color) {
    e.hp -= amount;
    e.flash = 0.09;
    damageNumber(e.x, e.y - e.radius, Math.round(amount), color ?? '#fff3c4');
    if (e.hp > 0) return false;
    e.active = false;
    state.kills += 1;
    state.score += e.score;
    const def = ENEMY[e.kind];
    burst(e.x, e.y, def.glow, BOSS_KINDS.includes(e.kind) ? 40 : 12, BOSS_KINDS.includes(e.kind) ? 260 : 170);
    burst(e.x, e.y, '#ff5a2e', BOSS_KINDS.includes(e.kind) ? 24 : 6, 120);
    spawnGem(e.x, e.y, 'ember', e.xp);
    if (!BOSS_KINDS.includes(e.kind) && random() < HEART_CHANCE) spawnGem(e.x, e.y, 'heart', HEART_HEAL);
    // A foe that dies alight leaves the floor burning where it fell.
    if (e.burnTimer > 0) {
      fire.igniteGround(e.x, e.y, stats.fireRadius, stats.fireDuration, random);
    }
    // A splitter bursts into mites when it dies — the horde grows from its own dead.
    if (e.kind === KIND_SPLITTER) {
      for (let i = 0; i < ENEMY.splitter.children; i += 1) {
        spawnEnemyAt(KIND_MITE, e.x + (random() - 0.5) * 44, e.y + (random() - 0.5) * 44);
      }
    }
    if (BOSS_KINDS.includes(e.kind)) {
      state.bossActive = false;
      state.shake = 18;
      ring(e.x, e.y, def.glow, 320);
    }
    return true;
  }

  function hurtPlayer(amount) {
    if (player.invulnerable > 0 || state.over) return 0;
    player.hp -= amount;
    player.invulnerable = PLAYER.invulnerable;
    player.hurtFlash = PLAYER.hurtFlash;
    state.shake = Math.max(state.shake, 9);
    burst(player.x, player.y, '#ff5a4a', 10, 150);
    if (player.hp <= 0) {
      player.hp = 0;
      state.over = true;
      return EVENT_HURT | EVENT_OVER;
    }
    return EVENT_HURT;
  }

  function fireVolley() {
    const target = nearestEnemy();
    if (!target) return 0;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    player.aimX = dx / len;
    player.aimY = dy / len;
    const count = stats.projectiles;
    const baseAngle = Math.atan2(player.aimY, player.aimX);
    for (let i = 0; i < count; i += 1) {
      const b = free(bolts);
      if (!b) break;
      const spread = (i - (count - 1) / 2) * 0.14;
      const angle = baseAngle + spread;
      b.active = true;
      b.x = player.x + Math.cos(angle) * (PLAYER.radius + 8);
      b.y = player.y + Math.sin(angle) * (PLAYER.radius + 8);
      b.vx = Math.cos(angle) * stats.boltSpeed;
      b.vy = Math.sin(angle) * stats.boltSpeed;
      b.damage = stats.boltDamage;
      b.pierce = 0;
    }
    return EVENT_SHOOT;
  }

  function updateEnemies(dt) {
    let events = 0;
    for (const e of enemies) {
      if (!e.active) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.touchTimer > 0) e.touchTimer -= dt;
      if (e.orbTimer > 0) e.orbTimer -= dt;
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;

      if (e.kind === KIND_SPITTER) {
        const keep = ENEMY.spitter.keepRange;
        let mx = 0;
        let my = 0;
        if (d > keep + 40) { mx = ux; my = uy; }
        else if (d < keep - 50) { mx = -ux; my = -uy; }
        else { mx = -uy * 0.4; my = ux * 0.4; }
        e.x += mx * e.speed * dt;
        e.y += my * e.speed * dt;
        e.shotTimer -= dt;
        if (e.shotTimer <= 0 && d < 560) {
          e.shotTimer = ENEMY.spitter.shotInterval;
          const b = free(ebullets);
          if (b) {
            b.active = true;
            b.x = e.x;
            b.y = e.y;
            b.vx = ux * ENEMY.spitter.shotSpeed;
            b.vy = uy * ENEMY.spitter.shotSpeed;
            b.damage = ENEMY.spitter.shotDamage;
            b.radius = 7;
          }
        }
      } else if (e.kind === KIND_DASHER) {
        // Dashers stalk slowly, then — inside range, off cooldown — telegraph a line
        // and lunge at the warden's position. The telegraph is the dodge window.
        const def = ENEMY.dasher;
        e.modeTimer -= dt;
        if (e.mode === 'chase') {
          e.x += ux * e.speed * dt;
          e.y += uy * e.speed * dt;
          if (e.modeTimer <= 0 && d < def.dashRange) {
            e.mode = 'telegraph';
            e.modeTimer = def.dashTelegraph;
            e.chargeX = ux;
            e.chargeY = uy;
          }
        } else if (e.mode === 'telegraph') {
          if (e.modeTimer <= 0) {
            e.mode = 'dash';
            e.modeTimer = def.dashTime;
          }
        } else if (e.mode === 'dash') {
          e.x += e.chargeX * def.dashSpeed * dt;
          e.y += e.chargeY * def.dashSpeed * dt;
          if (e.modeTimer <= 0) {
            e.mode = 'recover';
            e.modeTimer = 0.5;
          }
        } else if (e.mode === 'recover') {
          if (e.modeTimer <= 0) {
            e.mode = 'chase';
            e.modeTimer = def.dashCooldown;
          }
        }
      } else if (BOSS_KINDS.includes(e.kind)) {
        // The Tyrantling and the Ash Tyrant share one mind: chase, spawn mites, and
        // telegraph a charge. Only the numbers differ (see ENEMY in config.js).
        const def = ENEMY[e.kind];
        e.modeTimer -= dt;
        e.spawnTimer -= dt;
        if (e.mode === 'chase') {
          e.x += ux * e.speed * dt;
          e.y += uy * e.speed * dt;
          if (e.spawnTimer <= 0) {
            e.spawnTimer = def.spawnInterval;
            let alive = 0;
            for (const other of enemies) if (other.active && other.kind === KIND_MITE) alive += 1;
            for (let i = 0; i < 4 && alive < 12; i += 1) {
              const mite = spawnEnemyAt(KIND_MITE, e.x + (random() - 0.5) * 90, e.y + (random() - 0.5) * 90);
              if (mite) alive += 1;
            }
          }
          if (e.modeTimer <= 0 && d > 160) {
            e.mode = 'telegraph';
            e.modeTimer = def.telegraphTime;
            e.chargeX = ux;
            e.chargeY = uy;
          }
        } else if (e.mode === 'telegraph') {
          if (e.modeTimer <= 0) {
            e.mode = 'charge';
            e.modeTimer = def.chargeTime;
          }
        } else if (e.mode === 'charge') {
          e.x += e.chargeX * def.chargeSpeed * dt;
          e.y += e.chargeY * def.chargeSpeed * dt;
          if (e.modeTimer <= 0) {
            e.mode = 'recover';
            e.modeTimer = 0.6;
          }
        } else if (e.mode === 'recover') {
          if (e.modeTimer <= 0) {
            e.mode = 'chase';
            e.modeTimer = def.chargeInterval;
          }
        }
      } else {
        // Mites, brutes and splitters chase the warden.
        e.x += ux * e.speed * dt;
        e.y += uy * e.speed * dt;
      }
      e.x = Math.min(FIELD.width - e.radius, Math.max(e.radius, e.x));
      e.y = Math.min(FIELD.height - e.radius, Math.max(e.radius, e.y));

      // Touch damage, throttled per foe.
      if (d < e.radius + PLAYER.radius && e.touchTimer <= 0) {
        e.touchTimer = 0.8;
        events |= hurtPlayer(e.contact);
        if (state.over) return events;
      }
    }

    // Foes shove each other apart so they never stack on one point.
    for (let i = 0; i < enemies.length; i += 1) {
      const a = enemies[i];
      if (!a.active) continue;
      for (let j = i + 1; j < enemies.length; j += 1) {
        const b = enemies[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
    return events;
  }

  function updateBolts(dt) {
    let events = 0;
    for (const b of bolts) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        // A bolt that dies on the arena wall kindles the floor where it struck — the
        // warden's stray fire rings the edges where the horde pours in.
        if (random() < GROUNDFIRE.wallIgniteChance) {
          fire.igniteGround(
            Math.min(FIELD.width - 10, Math.max(10, b.x)),
            Math.min(FIELD.height - 10, Math.max(10, b.y)),
            stats.fireRadius * 0.8, stats.fireDuration, random,
          );
        }
        b.active = false;
        continue;
      }
      for (const e of enemies) {
        if (!e.active) continue;
        const rr = PLAYER.boltRadius + e.radius;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          const died = damageEnemy(e, b.damage);
          burst(b.x, b.y, '#ffb347', 4, 90);
          // Kindled Ground: a bolt that strikes a foe sets the floor alight under it.
          if (random() < GROUNDFIRE.igniteChance) {
            fire.igniteGround(b.x, b.y, stats.fireRadius, stats.fireDuration, random);
          }
          if (died) {
            events |= EVENT_KILL;
            if (e.kind === KIND_BOSS) events |= EVENT_VICTORY;
          }
          b.pierce -= 1;
          if (b.pierce < 0) {
            b.active = false;
            break;
          }
        }
      }
    }
    return events;
  }

  function updateGems(dt) {
    let events = 0;
    for (const g of gems) {
      if (!g.active) continue;
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = stats.pickupRadius;
      if (d < pull) {
        const speed = 520 * (1 - d / (pull + 60)) + 180;
        g.vx += (dx / d) * speed * dt * 6;
        g.vy += (dy / d) * speed * dt * 6;
      } else if (d < 280) {
        // A faint ember-drift: far embers creep toward the warden, so a kill at range
        // still feeds the next blessing instead of littering the arena.
        g.vx += (dx / d) * 55 * dt;
        g.vy += (dy / d) * 55 * dt;
      }
      g.vx *= 0.92;
      g.vy *= 0.92;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (d < PLAYER.radius + 12) {
        g.active = false;
        if (g.kind === 'heart') {
          player.hp = Math.min(stats.maxHp, player.hp + g.value);
          events |= EVENT_HEAL;
          burst(g.x, g.y, '#ff5a7a', 8, 110);
        } else {
          state.xp += g.value;
          state.score += g.value * 2;
          events |= EVENT_PICKUP;
          burst(g.x, g.y, '#ff9a2e', 4, 80);
          while (state.xp >= state.xpNext) {
            state.xp -= state.xpNext;
            state.level += 1;
            state.xpNext = xpForLevel(state.level);
            state.pendingLevels += 1;
          }
          if (state.pendingLevels > 0 && !state.choices) {
            state.choices = rollChoices(random, state.taken, 3);
            events |= EVENT_LEVELUP;
          }
        }
      }
    }
    return events;
  }

  function updateEbullets(dt) {
    let events = 0;
    for (const b of ebullets) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        b.active = false;
        continue;
      }
      const rr = b.radius + PLAYER.radius;
      if (dist2(b.x, b.y, player.x, player.y) < rr * rr) {
        b.active = false;
        events |= hurtPlayer(b.damage);
        if (state.over) return events;
      }
    }
    return events;
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      if (p.kind === 'spark') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
      } else if (p.kind === 'rise') {
        // Title embers drift upward, swaying side to side as they climb.
        p.x += (p.vx + Math.sin(state.elapsed * 2 + p.y * 0.05) * 8) * dt;
        p.y += p.vy * dt;
        if (p.y < -10) p.active = false;
      }
    }
    for (const n of numbers) {
      if (!n.active) continue;
      n.life -= dt;
      n.y -= 34 * dt;
      if (n.life <= 0) n.active = false;
    }
  }

  function updateNovaAndOrbs(dt) {
    let events = 0;
    if (stats.novaLevel > 0) {
      state.novaTimer -= dt;
      if (state.novaTimer <= 0) {
        state.novaTimer = stats.novaInterval;
        ring(player.x, player.y, '#ff7a2e', stats.novaRadius);
        let hitAny = false;
        for (const e of enemies) {
          if (!e.active) continue;
          const rr = stats.novaRadius + e.radius;
          if (dist2(e.x, e.y, player.x, player.y) < rr * rr) {
            const died = damageEnemy(e, stats.novaDamage, '#ff9a2e');
            hitAny = true;
            if (died && e.kind === KIND_BOSS) events |= EVENT_VICTORY;
          }
        }
        if (hitAny) events |= EVENT_NOVA;
      }
    }
    if (stats.orbs > 0) {
      state.orbAngle += dt * 2.8;
      for (let i = 0; i < stats.orbs; i += 1) {
        const angle = state.orbAngle + (i * TAU) / stats.orbs;
        const ox = player.x + Math.cos(angle) * stats.orbRadius;
        const oy = player.y + Math.sin(angle) * stats.orbRadius;
        for (const e of enemies) {
          if (!e.active || e.orbTimer > 0) continue;
          const rr = 14 + e.radius;
          if (dist2(ox, oy, e.x, e.y) < rr * rr) {
            e.orbTimer = 0.35;
            const died = damageEnemy(e, stats.orbDamage, '#ffb347');
            if (died && e.kind === KIND_BOSS) events |= EVENT_VICTORY;
          }
        }
      }
    }
    return events;
  }

  function aliveEnemies() {
    let count = 0;
    for (const e of enemies) if (e.active) count += 1;
    return count;
  }

  /**
   * One fixed step. `move` is {x, y} in [-1, 1]. With mode 'title' the arena idles as a
   * backdrop: foes wander, nothing fights. With mode 'play' the full rules run.
   */
  function step(dt, move, mode) {
    let events = 0;
    state.elapsed += dt;
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 32);
    if (player.invulnerable > 0) player.invulnerable -= dt;
    if (player.hurtFlash > 0) player.hurtFlash -= dt;

    if (mode === 'title') {
      // The title backdrop is a living arena, not a void: a crowd of foes wanders the
      // hall, ground-fire kindles in patches behind the panel, and embers rise from the
      // floor. The warden stands at the arena's edge, in sight beside the title panel.
      player.x = 170;
      player.y = 380;
      player.aimX = 1;
      player.aimY = 0;
      let count = 0;
      for (const e of enemies) if (e.active) count += 1;
      if (count < TITLE_FOES && random() < dt * TITLE_SPAWN_RATE) {
        const roll = random();
        const kind = roll < 0.5 ? KIND_MITE
          : roll < 0.65 ? KIND_BRUTE
          : roll < 0.78 ? KIND_SPITTER
          : roll < 0.89 ? KIND_DASHER
          : KIND_SPLITTER;
        spawnEnemy(kind);
      }
      for (const e of enemies) {
        if (!e.active) continue;
        e.wanderTimer -= dt;
        if (e.wanderTimer <= 0) {
          e.wanderTimer = 1.5 + random() * 2;
          e.wanderX = 80 + random() * (FIELD.width - 160);
          e.wanderY = 80 + random() * (FIELD.height - 160);
          // Keep the crowd where it can be seen: a wander target behind the title panel
          // slides out to the nearest side margin instead.
          if (e.wanderX > 310 && e.wanderX < 970 && e.wanderY > 140 && e.wanderY < 580) {
            e.wanderX = e.wanderX < FIELD.width / 2 ? 110 + random() * 200 : 970 + random() * 200;
          }
        }
        const dx = e.wanderX - e.x;
        const dy = e.wanderY - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d) * e.speed * 0.35 * dt;
        e.y += (dy / d) * e.speed * 0.35 * dt;
      }
      // Ground-fire kindles on its own behind the panel; the wandering foes are scenery
      // and do not burn, so only the patches decay here.
      state.titleFireTimer -= dt;
      if (state.titleFireTimer <= 0) {
        state.titleFireTimer = TITLE_FIRE_SECONDS;
        fire.igniteGround(
          80 + random() * (FIELD.width - 160),
          80 + random() * (FIELD.height - 160),
          1, 1, random,
        );
      }
      fire.decayPatches(dt);
      // Embers rise from the floor in a slow, steady drift.
      if (random() < dt * 9) {
        const p = free(particles);
        if (p) {
          p.active = true;
          p.kind = 'rise';
          p.x = 40 + random() * (FIELD.width - 80);
          p.y = FIELD.height - 20 - random() * 120;
          p.vx = (random() - 0.5) * 12;
          p.vy = -(18 + random() * 26);
          p.maxLife = 2.5 + random() * 2;
          p.life = p.maxLife;
          p.size = 1.5 + random() * 2;
          p.color = random() < 0.5 ? '#ffb347' : '#ff7a2e';
        }
      }
      updateParticles(dt);
      return events;
    }

    // Player movement.
    const len = Math.hypot(move.x, move.y);
    const nx = len > 0 ? move.x / len : 0;
    const ny = len > 0 ? move.y / len : 0;
    player.x = Math.min(FIELD.width - PLAYER.radius, Math.max(PLAYER.radius, player.x + nx * stats.speed * dt));
    player.y = Math.min(FIELD.height - PLAYER.radius, Math.max(PLAYER.radius, player.y + ny * stats.speed * dt));

    // Wave flow.
    if (state.waveState === 'banner') {
      state.stateTimer -= dt;
      if (state.stateTimer <= 0) {
        state.waveState = 'fight';
        state.spawnTimer = 0.2;
      }
    } else if (state.waveState === 'fight') {
      const wave = WAVES[state.wave - 1];
      if (state.spawnQueue.length > 0) {
        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          state.spawnTimer = wave.interval;
          const kind = state.spawnQueue.shift();
          const spawned = spawnEnemy(kind);
          if (spawned && kind === KIND_BOSS) events |= EVENT_BOSS;
        }
      } else if (aliveEnemies() === 0) {
        state.score += 100 * state.wave;
        events |= EVENT_WAVE_CLEAR;
        if (state.wave >= LAST_WAVE) {
          state.victory = true;
          events |= EVENT_VICTORY;
        } else {
          state.waveState = 'between';
          state.stateTimer = BETWEEN_WAVE_SECONDS;
          player.hp = Math.min(stats.maxHp, player.hp + BETWEEN_WAVE_HEAL);
        }
      }
    } else if (state.waveState === 'between') {
      state.stateTimer -= dt;
      if (state.stateTimer <= 0) startWave(state.wave + 1);
    }

    // Combat.
    player.fireTimer -= dt;
    if (player.fireTimer <= 0) {
      events |= fireVolley();
      player.fireTimer = stats.fireInterval;
    }
    events |= updateEnemies(dt);
    if (state.over) return events;
    events |= updateBolts(dt);
    if (state.victory) return events;
    events |= updateGems(dt);
    events |= updateEbullets(dt);
    if (state.over) return events;
    events |= updateNovaAndOrbs(dt);
    // Kindled Ground: the floor burns, foes standing in the flames catch alight, and
    // burning foes trail fire behind them. A foe the fire finishes counts as a kill,
    // and the Tyrant burning to death is still a victory.
    let fireEvents = 0;
    fire.updateGroundFire(dt, enemies, damageEnemy, (e) => {
      fireEvents |= EVENT_KILL;
      if (e.kind === KIND_BOSS) fireEvents |= EVENT_VICTORY;
    }, random, stats);
    events |= fireEvents;
    updateParticles(dt);
    return events;
  }

  /** Take one of the offered blessings; rolls the next choice if another level waits. */
  function applyUpgrade(id) {
    const def = findUpgrade(id);
    if (!def || !state.choices) return false;
    def.apply(stats);
    state.taken[id] = (state.taken[id] ?? 0) + 1;
    if (def.heal) player.hp = Math.min(stats.maxHp, player.hp + def.heal);
    state.pendingLevels = Math.max(0, state.pendingLevels - 1);
    if (state.pendingLevels > 0) {
      state.choices = rollChoices(random, state.taken, 3);
    } else {
      state.choices = null;
    }
    return true;
  }

  /** Grant XP from outside a gem pickup (play-testing lever); rolls a level-up if due. */
  function grantXp(amount) {
    let events = EVENT_PICKUP;
    state.xp += amount;
    while (state.xp >= state.xpNext) {
      state.xp -= state.xpNext;
      state.level += 1;
      state.xpNext = xpForLevel(state.level);
      state.pendingLevels += 1;
    }
    if (state.pendingLevels > 0 && !state.choices) {
      state.choices = rollChoices(random, state.taken, 3);
      events |= EVENT_LEVELUP;
    }
    return events;
  }

  reset();
  return { state, reset, step, applyUpgrade, grantXp, nearestEnemy, aliveEnemies };
}
