// The level-up choices: nine ember blessings, each stackable to its own cap. A choice is a
// plain record — name, flavour, what it does to the warden's stats — so the world can apply
// it, the renderer can draw its card (each blessing has its own colour and canvas icon),
// and the autopilot can rank it, all from the same data.
//
// Most blessings are stat growth, but two change how the game plays: Nova Pulse and
// Orbiting Sparks add new damage sources, and Wildfire turns the warden's bolts into
// ground-fire — the wider and hotter the flames, the more the fight becomes about herding
// the horde through them.

export const UPGRADE_DEFS = [
  {
    id: 'damage', name: 'Kindled Edge', max: 5,
    blurb: '+25% ember bolt damage',
    color: '#ffb347', icon: 'flame',
    apply(stats) { stats.boltDamage *= 1.25; },
  },
  {
    id: 'rate', name: 'Rapid Ignition', max: 5,
    blurb: '+18% bolt fire rate',
    color: '#ffd76a', icon: 'burst',
    apply(stats) { stats.fireInterval /= 1.18; },
  },
  {
    id: 'twin', name: 'Twin Embers', max: 3,
    blurb: '+1 bolt in every volley',
    color: '#ff9a2e', icon: 'twin',
    apply(stats) { stats.projectiles += 1; },
  },
  {
    id: 'wildfire', name: 'Wildfire', max: 3,
    blurb: 'Bolts kindle wider, hotter ground-fire that burns longer',
    color: '#ff6b2e', icon: 'wildfire',
    apply(stats) {
      stats.fireRadius *= 1.3;
      stats.fireDamage *= 1.35;
      stats.fireDuration *= 1.25;
    },
  },
  {
    id: 'nova', name: 'Nova Pulse', max: 3,
    blurb: 'A ring of fire erupts around you every 6s',
    color: '#ff2e63', icon: 'ring',
    apply(stats) {
      stats.novaLevel += 1;
      stats.novaDamage += 25;
      stats.novaRadius += 30;
    },
  },
  {
    id: 'orbs', name: 'Orbiting Sparks', max: 4,
    blurb: '+1 burning spark orbits the warden',
    color: '#ffe9a8', icon: 'orbit',
    apply(stats) {
      stats.orbs += 1;
      stats.orbDamage += 2;
    },
  },
  {
    id: 'heart', name: 'Ember Heart', max: 5,
    blurb: '+25 max HP and mend 25 HP now',
    color: '#ff5a7a', icon: 'heart',
    apply(stats) { stats.maxHp += 25; },
    heal: 25,
  },
  {
    id: 'magnet', name: 'Magnet Charm', max: 3,
    blurb: '+55% ember pickup range',
    color: '#c07bff', icon: 'magnet',
    apply(stats) { stats.pickupRadius *= 1.55; },
  },
  {
    id: 'boots', name: 'Swift Boots', max: 3,
    blurb: '+12% move speed',
    color: '#7ad7ff', icon: 'boot',
    apply(stats) { stats.speed *= 1.12; },
  },
];

/** How much the autopilot wants each blessing, best first, when it must choose alone. */
export const AUTOPILOT_PRIORITY = [
  'damage', 'twin', 'wildfire', 'rate', 'nova', 'orbs', 'magnet', 'boots', 'heart',
];

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
