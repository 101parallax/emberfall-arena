// Kindled Ground — the hook that sets Emberfall apart from a plain arena survivor: the
// warden's bolts set the floor alight, and the fire is a weapon of its own.
//
//   * igniteGround — a bolt strike (or a bolt dying on the wall) kindles a patch of
//     ground-fire where it lands. Patches burn for a few seconds, then gutter out.
//   * burnEnemies — a foe standing in the flames catches alight: it keeps burning for a
//     while after it leaves the fire, taking damage in steady ticks.
//   * spreadFire — a burning foe kindles the ground beneath it as it runs, so a horde
//     chased through one patch trails fire behind it, and a foe that dies alight leaves
//     a patch where it fell.
//
// Everything here is pooled and seeded: no allocation per step, no Math.random, so a fixed
// seed replays the same flames frame for frame. The world owns the ground-fire and hands
// this module its enemy pool, its damage function and its seeded generator each step.

import { FIELD, GROUNDFIRE } from './config.js';

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function createGroundFire() {
  const patches = [];
  for (let i = 0; i < GROUNDFIRE.pool; i += 1) {
    patches.push({
      active: false, x: 0, y: 0, radius: GROUNDFIRE.radius,
      life: 0, maxLife: 1, seed: 0,
    });
  }

  /** How many patches are burning right now. */
  function activeCount() {
    let count = 0;
    for (const p of patches) if (p.active) count += 1;
    return count;
  }

  /** Put every patch out (a fresh run, or a reset). */
  function reset() {
    for (const p of patches) p.active = false;
  }

  /**
   * Kindle a patch of ground-fire at (x, y). `radiusScale` and `durationScale` come from
   * the warden's blessings (Wildfire makes the flames wider and longer-lived). When the
   * pool is full the patch closest to guttering out is rekindled instead, so fresh fire
   * never fails to appear.
   */
  function igniteGround(x, y, radiusScale, durationScale, random) {
    let slot = null;
    let stalest = null;
    for (const p of patches) {
      if (!p.active) {
        slot = p;
        break;
      }
      if (!stalest || p.life < stalest.life) stalest = p;
    }
    const patch = slot ?? stalest;
    if (!patch) return;
    patch.active = true;
    patch.x = Math.min(FIELD.width - 8, Math.max(8, x));
    patch.y = Math.min(FIELD.height - 8, Math.max(8, y));
    // A patch is never a perfect disc: its radius and flicker phase vary per kindling.
    patch.radius = GROUNDFIRE.radius * radiusScale * (0.85 + random() * 0.3);
    patch.maxLife = GROUNDFIRE.duration * durationScale;
    patch.life = patch.maxLife;
    patch.seed = random();
  }

  /** Let every patch burn down a step; patches at zero life go out. */
  function decayPatches(dt) {
    for (const p of patches) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
  }

  /**
   * Set alight every foe standing in the flames, tick the burn on foes already alight,
   * and let burning foes kindle the ground under them. `damageEnemy` is the world's own
   * damage function (it returns true when the foe dies); `onBurnKill` is called for
   * every foe the fire finishes, so the world can count the kill and end the run when
   * the Tyrant burns. Returns nothing — kills flow through the callback.
   */
  function burnEnemies(dt, enemies, damageEnemy, onBurnKill, random, damageScale) {
    // First pass: any foe inside a patch catches alight (refreshing its burn clock).
    for (const e of enemies) {
      if (!e.active) continue;
      for (const p of patches) {
        if (!p.active) continue;
        const rr = p.radius + e.radius * 0.6;
        if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
          e.burnTimer = GROUNDFIRE.burnSeconds;
          break;
        }
      }
    }
    // Second pass: burning foes take tick damage and spread the fire as they run.
    for (const e of enemies) {
      if (!e.active || e.burnTimer <= 0) continue;
      e.burnTimer -= dt;
      e.burnTick += dt;
      if (e.spreadTimer > 0) e.spreadTimer -= dt;
      if (e.spreadTimer <= 0 && random() < GROUNDFIRE.spreadChance) {
        e.spreadTimer = GROUNDFIRE.spreadCooldown;
        spreadFire(e, random, 1, 1);
      }
      if (e.burnTick >= GROUNDFIRE.burnTickSeconds) {
        e.burnTick -= GROUNDFIRE.burnTickSeconds;
        const died = damageEnemy(e, GROUNDFIRE.damagePerSecond * GROUNDFIRE.burnTickSeconds * damageScale, '#ff7a2e');
        if (died) onBurnKill(e);
      }
    }
  }

  /**
   * Kindle the ground under a burning foe. `radiusScale`/`durationScale` are 1 for a
   * spread patch — only the warden's own bolts carry the Wildfire blessing — so the
   * fire a horde trails behind it is smaller than the fire the warden starts.
   */
  function spreadFire(enemy, random, radiusScale, durationScale) {
    igniteGround(enemy.x, enemy.y, radiusScale, durationScale, random);
  }

  /**
   * One step of the whole system: patches gutter out, foes in the flames catch alight,
   * burning foes take their ticks and spread the fire. Call it from the world's play
   * step; the title backdrop calls decayPatches + igniteGround directly, since its
   * wandering foes are scenery and must not burn.
   */
  function updateGroundFire(dt, enemies, damageEnemy, onBurnKill, random, stats) {
    decayPatches(dt);
    burnEnemies(dt, enemies, damageEnemy, onBurnKill, random, stats.fireDamage);
  }

  return {
    patches,
    activeCount,
    reset,
    igniteGround,
    decayPatches,
    burnEnemies,
    spreadFire,
    updateGroundFire,
  };
}
