// A small seeded random number generator (splitmix32): the same seed gives the same game,
// which is what makes the screenshot scenes repeatable. Nothing in the simulation uses
// Math.random, so a fixed seed replays the same run, frame for frame.

export function createRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** A whole number in [0, max). */
export function randomInt(random, max) {
  return Math.floor(random() * max);
}

/** Pick one element of an array. */
export function randomPick(random, list) {
  return list[randomInt(random, list.length)];
}
