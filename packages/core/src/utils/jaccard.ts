import assert from 'node:assert';

/**
 * Computes Jaccard similarity between two tag arrays.
 * Jaccard = |intersection| / |union|. Returns 0 if both arrays are empty.
 * P10 Rule 2: inner loop bounded by setA.size (tag cardinality 2–5 per corpus).
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  assert(Array.isArray(a) && Array.isArray(b), 'tag arrays must be arrays');
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const tag of setA) { // P10 Rule 2: bounded by setA.size (small tag list)
    if (setB.has(tag)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  const result = union === 0 ? 0 : intersection / union;
  assert(result >= 0 && result <= 1, 'Jaccard result must be in [0,1]');
  return result;
}

/** Minimum Jaccard similarity for topic_tags match. Set from corpus; tag cardinality 2–5. */
export const JACCARD_MATCH_THRESHOLD = 0.5;
