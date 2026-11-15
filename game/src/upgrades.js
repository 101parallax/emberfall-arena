// The level-up choices: eight ember blessings, each stackable to its own cap. A choice is a
// plain record — name, flavour, what it does to the warden's stats — so the world can apply
// it, the renderer can draw its card, and the autopilot can rank it, all from the same data.

export const UPGRADE_DEFS = [
  {
    id: 'damage', name: 'Kindled Edge', max: 5,
    blurb: '+25% ember bolt damage',
    apply(stats) { stats.boltDamage *= 1.25; },
  },
  {
    id: 'rate', name: 'Rapid Ignition', max: 5,
    blurb: '+18% bolt fire rate',
    apply(stats) { stats.fireInterval /= 1.18; },
  },
  {
    id: 'twin', name: 'Twin Embers', max: 3,
    blurb: '+1 bolt in every volley',
    apply(stats) { stats.projectiles += 1; },
  },
  {
    id: 'nova', name: 'Nova Pulse', max: 3,
    blurb: 'A ring of fire erupts around you every 6s',
    apply(stats) {
      stats.novaLevel += 1;
      stats.novaDamage += 25;
      stats.novaRadius += 30;
    },
  },
  {
    id: 'orbs', name: 'Orbiting Sparks', max: 4,
    blurb: '+1 burning spark orbits the warden',
    apply(stats) {
      stats.orbs += 1;
      stats.orbDamage += 2;
    },
  },
  {
    id: 'heart', name: 'Ember Heart', max: 5,
    blurb: '+25 max HP and mend 25 HP now',
    apply(stats) { stats.maxHp += 25; },
    heal: 25,
  },
  {
    id: 'magnet', name: 'Magnet Charm', max: 3,
    blurb: '+55% ember pickup range',
    apply(stats) { stats.pickupRadius *= 1.55; },
  },
  {
    id: 'boots', name: 'Swift Boots', max: 3,
    blurb: '+12% move speed',
    apply(stats) { stats.speed *= 1.12; },
  },
];

/** How much the autopilot wants each blessing, best first, when it must choose alone. */
export const AUTOPILOT_PRIORITY = ['damage', 'twin', 'rate', 'nova', 'orbs', 'magnet', 'boots', 'heart'];

export function findUpgrade(id) {
  return UPGRADE_DEFS.find((def) => def.id === id);
}

/**
 * Roll `count` distinct blessings the warden can still take (below their cap), in a random
 * order. Returns fewer when almost everything is maxed out.
 */
export function rollChoices(random, taken, count = 3) {
  const available = UPGRADE_DEFS.filter((def) => (taken[def.id] ?? 0) < def.max);
  const picks = [];
  while (picks.length < count && available.length > 0) {
    const index = Math.floor(random() * available.length);
    picks.push(available.splice(index, 1)[0]);
  }
  return picks;
}
