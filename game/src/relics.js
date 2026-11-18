// The relics: six keepsakes of the burnt arena, each a passive gift the warden carries
// for the rest of the run. They are rarer than blessings — a run offers at most six, one
// from the Tyrantling, one from the Ash Tyrant, and one from each elite brute — and each
// is taken at most once, so a full set is a run worth remembering. A relic is a plain
// record — name, flavour, what it does to the warden's stats — so the world can grant it,
// the renderer can name it in the HUD, and the victory screen can count it, all from the
// same data. Nothing here rolls dice on its own: rollRelic takes the world's seeded
// generator, so a fixed seed finds the same relics in the same order.

export const RELIC_DEFS = [
  {
    id: 'cinderheart', name: 'Cinderheart Coal', max: 1,
    blurb: '+25 max HP and mend 25 HP now',
    color: '#ff5a7a',
    apply(stats) { stats.maxHp += 25; },
    heal: 25,
  },
  {
    id: 'ashenlens', name: 'Ashen Lens', max: 1,
    blurb: '+60% ember pickup range',
    color: '#c07bff',
    apply(stats) { stats.pickupRadius *= 1.6; },
  },
  {
    id: 'slowburn', name: 'Slowburn Coal', max: 1,
    blurb: 'Ground-fire burns 50% longer',
    color: '#ff7a2e',
    apply(stats) { stats.fireDuration *= 1.5; },
  },
  {
    id: 'piercing', name: 'Piercing Cinder', max: 1,
    blurb: 'Bolts pass through +1 foe',
    color: '#ffd76a',
    apply(stats) { stats.boltPierce += 1; },
  },
  {
    id: 'rekindled', name: 'Rekindled Hearth', max: 1,
    blurb: 'Mend 15 HP at the end of every wave',
    color: '#ff9a2e',
    apply(stats) { stats.waveHeal += 15; },
  },
  {
    id: 'tithe', name: 'Ember Tithe', max: 1,
    blurb: '+25% XP from embers',
    color: '#ffe9a8',
    apply(stats) { stats.xpGain *= 1.25; },
  },
];

/** How many relics exist in all — the HUD's "RELICS n/6" counts against this. */
export const RELIC_COUNT = RELIC_DEFS.length;

export function findRelic(id) {
  return RELIC_DEFS.find((def) => def.id === id);
}

/**
 * Roll one relic the warden does not already carry, from the pool that is left. Returns
 * null when the warden holds the whole set — a run that finds everything finds nothing
 * more, and the world quietly grants nothing instead of a duplicate.
 */
export function rollRelic(random, owned) {
  const remaining = RELIC_DEFS.filter((def) => !owned.includes(def.id));
  if (remaining.length === 0) return null;
  return remaining[Math.floor(random() * remaining.length)];
}
