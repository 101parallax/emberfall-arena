// Every tuning number and colour for Emberfall: Ashen Arena, in one place. The playfield is
// a fixed 1280x720 logical area; the renderer scales it to the window, so no rule below
// depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How many waves the run lasts; the Ash Tyrant waits at the end of the last one. */
export const LAST_WAVE = 5;

export const PLAYER = {
  radius: 15,
  speed: 265,
  maxHp: 100,
  boltDamage: 14,
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
    radius: 11, hp: 16, speed: 196, contact: 9, xp: 1, score: 10,
    body: '#c98a4b', glow: '#ffb347', spikes: 5,
  },
  brute: {
    radius: 20, hp: 85, speed: 88, contact: 16, xp: 3, score: 30,
    body: '#8a4a3c', glow: '#ff6b4a', spikes: 6,
  },
  spitter: {
    radius: 13, hp: 34, speed: 116, contact: 10, xp: 2, score: 25,
    body: '#7a5aa8', glow: '#c07bff', spikes: 4,
    shotInterval: 2.4, shotSpeed: 225, shotDamage: 12, keepRange: 270,
  },
  boss: {
    radius: 42, hp: 880, speed: 74, contact: 26, xp: 50, score: 1000,
    body: '#5a2e3e', glow: '#ff2e63', spikes: 8,
    spawnInterval: 6, chargeInterval: 8, chargeSpeed: 460, chargeTime: 0.7, telegraphTime: 0.7,
  },
};

/** What each wave throws at the warden: counts per kind, spawn pacing, boss on the last. */
export const WAVES = [
  { mites: 14, brutes: 0, spitters: 0, interval: 0.95 },
  { mites: 20, brutes: 5, spitters: 0, interval: 0.8 },
  { mites: 22, brutes: 8, spitters: 5, interval: 0.72 },
  { mites: 26, brutes: 10, spitters: 7, interval: 0.62 },
  { mites: 10, brutes: 3, spitters: 4, interval: 0.8, boss: true },
];

/** Seconds of breathing room (and a small mend) between waves. */
export const BETWEEN_WAVE_SECONDS = 3;
export const BETWEEN_WAVE_HEAL = 18;

/** Pool sizes: everything is allocated once, at boot; nothing allocates per step. */
export const POOLS = { enemies: 96, bolts: 64, gems: 160, ebullets: 64, particles: 320, numbers: 48 };

/** A heart ember's heal, and how often a slain foe drops one instead of an ember. */
export const HEART_HEAL = 10;
export const HEART_CHANCE = 0.08;

export const PALETTE = {
  backdrop: '#0d0812',
  floorA: '#1d1420',
  floorB: '#241a26',
  floorEdge: '#3a2a33',
  ruin: '#2e2230',
  ruinTop: '#4a3644',
  crack: '#ff7a2e',
  crackDim: '#7a3a1e',
  ash: '#8a7a8a',
  player: '#ffb347',
  playerCore: '#fff3c4',
  playerCloak: '#7a3a5e',
  bolt: '#ffb347',
  boltCore: '#fff3c4',
  ember: '#ff9a2e',
  emberCore: '#ffe9a8',
  heart: '#ff5a7a',
  text: '#f5ead9',
  muted: '#b8a898',
  dim: '#7a6a72',
  panel: '#241a26',
  panelEdge: '#5a3a4a',
  hpBar: '#ff5a4a',
  hpBack: '#3a2230',
  xpBar: '#ffb347',
  waveBanner: '#ffb347',
  danger: '#ff2e63',
  card: '#2e2130',
  cardEdge: '#ffb347',
  cardHover: '#3d2b3d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'emberfall.best';
