/**
 * Deterministic string hash (cyrb32-style) — turns an arbitrary seed
 * string into a 32-bit integer for `mulberry32`. Same string always
 * produces the same number; different strings produce very different
 * numbers (good avalanche behavior for this non-cryptographic use).
 */
function hashSeed(seed: string): number {
  let h = 0x2f6e2b1;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG. Same seed ⇒ same sequence, every time, on every machine. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle, seeded by an arbitrary string. Same `seed` + same input array (by value) ⇒ same output order, always (reproducibility). Never mutates the input. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = items.slice();
  const rand = mulberry32(hashSeed(seed));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
