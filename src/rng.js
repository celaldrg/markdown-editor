/**
 * Small seeded pseudo random number generator (mulberry32). Injected into the
 * workspace so document ids are reproducible in tests and in the demo.
 */

/**
 * Creates a deterministic random number generator.
 * @param {number} seed - any 32-bit integer
 * @returns {() => number} returns floats in [0, 1)
 */
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
