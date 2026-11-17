// Every tuning number and colour for Emberfall: Ashen Arena, in one place. The playfield is
// a fixed 1280x720 logical area; the renderer scales it to the window, so no rule below
// depends on the screen size.
//
// The arena is deliberately bright for a game about ash: the flagstones sit above the
// "nearly black" line even before the ember light hits them, so a screenshot of a fight
// reads as a crowded, burning hall rather than a void with a few sparks in it.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How many waves the run lasts; the Ash Tyrant waits at the end of the last one. */
export const LAST_WAVE = 7;

/** Which wave the Tyrantling — the young Tyrant, a mini-boss — guards. */
export const MINIBOSS_WAVE = 4;

export const PLAYER = {
  radius: 15,
  speed: 265,
  maxHp: 100,
  boltDamage: 15,
  fireInterval: 0.5,
  boltSpeed: 560,
  boltRadius: 6,
  pickupRadius: 100,
  projectiles: 1,
  invulnerable: 0.6,
  /** Seconds a hurt player flashes and cannot be hurt again. */
  hurtFlash: 0.35,
};

/** XP needed to rise from `level` to `level + 1`. */
export function xpForLevel(level) {
  return 6 + (level - 1) * 6;
}

export const ENEMY = {
  mite: {
    radius: 11, hp: 30, speed: 196, contact: 9, xp: 1, score: 10,
    body: '#d09a55', glow: '#ffb347', spikes: 5,
  },
  brute: {
    radius: 20, hp: 110, speed: 88, contact: 16, xp: 3, score: 30,
    body: '#9a5644', glow: '#ff6b4a', spikes: 6,
  },
  spitter: {
    radius: 13, hp: 45, speed: 116, contact: 10, xp: 2, score: 25,
    body: '#8a68b8', glow: '#c07bff', spikes: 4,
    shotInterval: 2.4, shotSpeed: 225, shotDamage: 12, keepRange: 270,
  },
  dasher: {
    radius: 12, hp: 40, speed: 128, contact: 12, xp: 2, score: 25,
    body: '#b8542e', glow: '#ff8a3c', spikes: 3,
    dashRange: 230, dashTelegraph: 0.5, dashSpeed: 520, dashTime: 0.35, dashCooldown: 2.6,
  },
  splitter: {
    radius: 16, hp: 55, speed: 132, contact: 11, xp: 2, score: 30,
    body: '#5a8a4a', glow: '#b8ff5a', spikes: 4,
    /** How many mites burst out of a slain splitter. */
    children: 2,
  },
  tyrantling: {
    radius: 30, hp: 700, speed: 84, contact: 20, xp: 25, score: 500,
    body: '#6a3244', glow: '#ff4a6a', spikes: 7,
    spawnInterval: 8, chargeInterval: 7, chargeSpeed: 420, chargeTime: 0.6, telegraphTime: 0.7,
  },
  boss: {
    radius: 42, hp: 2400, speed: 74, contact: 26, xp: 50, score: 1000,
    body: '#6a3648', glow: '#ff2e63', spikes: 8,
    spawnInterval: 5, chargeInterval: 6, chargeSpeed: 460, chargeTime: 0.7, telegraphTime: 0.7,
  },
};

/**
 * What each wave throws at the warden: counts per kind, spawn pacing, the Tyrantling on
 * wave 4 and the Ash Tyrant on the last. Intervals are short on purpose — the arena should
 * feel crowded, with a dozen or more foes on screen through the middle of a wave — and the
 * higher hit points (a mite takes two bolts now) keep the horde from evaporating the moment
 * it arrives.
 */
export const WAVES = [
  { mites: 18, brutes: 0, spitters: 0, dashers: 0, splitters: 0, interval: 0.55 },
  { mites: 24, brutes: 5, spitters: 0, dashers: 0, splitters: 0, interval: 0.45 },
  { mites: 24, brutes: 8, spitters: 5, dashers: 4, splitters: 0, interval: 0.42 },
  { mites: 22, brutes: 8, spitters: 6, dashers: 5, splitters: 4, interval: 0.4, miniboss: true },
  { mites: 26, brutes: 10, spitters: 7, dashers: 6, splitters: 5, interval: 0.38 },
  { mites: 28, brutes: 12, spitters: 8, dashers: 8, splitters: 6, interval: 0.35 },
  { mites: 20, brutes: 8, spitters: 7, dashers: 7, splitters: 6, interval: 0.42, boss: true },
];

/** Seconds of breathing room (and a small mend) between waves. */
export const BETWEEN_WAVE_SECONDS = 3;
export const BETWEEN_WAVE_HEAL = 24;

/** Pool sizes: everything is allocated once, at boot; nothing allocates per step. */
export const POOLS = {
  enemies: 128, bolts: 96, gems: 224, ebullets: 64, particles: 448, numbers: 64,
};

/** A heart ember's heal, and how often a slain foe drops one instead of an ember. */
export const HEART_HEAL = 10;
export const HEART_CHANCE = 0.08;

/**
 * Kindled Ground: the warden's bolts set the floor alight. A bolt that strikes a foe — or
 * dies against the arena wall — kindles a patch of ground-fire; foes standing in the flames
 * catch alight, keep burning after they leave them, and kindle the ground beneath them as
 * they run. The Wildfire blessing multiplies the radius, the burn and the duration.
 */
export const GROUNDFIRE = {
  /** Patches alive at once; when the pool is full the oldest patch is rekindled. */
  pool: 56,
  /** Patch radius in pixels at full strength. */
  radius: 30,
  /** Damage per second a burning foe takes. */
  damagePerSecond: 10,
  /** Seconds a patch burns before it gutters out. */
  duration: 3.2,
  /** Chance a bolt hit kindles the floor (seeded roll). */
  igniteChance: 0.7,
  /** Chance a bolt dying on the wall kindles the floor there. */
  wallIgniteChance: 0.6,
  /** Chance a burning foe kindles the ground under it, per spread tick. */
  spreadChance: 0.4,
  /** Seconds between a burning foe's spread ticks. */
  spreadCooldown: 0.6,
  /** Seconds a foe stays alight after leaving the flames. */
  burnSeconds: 2.0,
  /** Seconds between burn damage ticks on one foe. */
  burnTickSeconds: 0.5,
};

/** How many foes wander the title screen's backdrop, and how fast they gather. */
export const TITLE_FOES = 20;
export const TITLE_SPAWN_RATE = 4;
/** Seconds between ground-fire patches kindling behind the title panel. */
export const TITLE_FIRE_SECONDS = 0.45;

export const PALETTE = {
  backdrop: '#17101d',
  floorA: '#382b3e',
  floorB: '#413349',
  floorEdge: '#5f4a66',
  ruin: '#453543',
  ruinTop: '#6a5270',
  crack: '#ff8a3c',
  crackDim: '#a04a24',
  ash: '#b0a0ac',
  fireCore: '#ffd76a',
  fireMid: '#ff7a2e',
  fireEdge: '#ff4a1e',
  player: '#ffb347',
  playerCore: '#fff3c4',
  playerCloak: '#7a3a5e',
  bolt: '#ffb347',
  boltCore: '#fff3c4',
  ember: '#ff9a2e',
  emberCore: '#ffe9a8',
  heart: '#ff5a7a',
  text: '#f5ead9',
  muted: '#c4b4a4',
  dim: '#8a7a84',
  panel: '#382b3f',
  panelEdge: '#6a4a5a',
  hpBar: '#ff5a4a',
  hpBack: '#40262e',
  xpBar: '#ffb347',
  waveBanner: '#ffb347',
  danger: '#ff2e63',
  card: '#3a2b44',
  cardEdge: '#ffb347',
  cardHover: '#4a3550',
};

/** How dark the vignette makes the arena's edges (0 = none, 1 = black). */
export const VIGNETTE = 0.28;

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'emberfall.best';
