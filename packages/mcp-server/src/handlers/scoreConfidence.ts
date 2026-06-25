import assert from 'node:assert';
import { SIGNAL_PATTERNS } from '@toto-wolff/core';
import type { SignalRecord } from '@toto-wolff/core';

/**
 * Hard constants — changing either requires a council record.
 * Council ruling: 2026-06-23-toto-wolff-v1-confidence-scoring-contract
 */
const N_DISTINCT = 2;
const JACCARD_MATCH_THRESHOLD = 0.5; // set from corpus; topic_tags cardinality 2-5; stricter side

/**
 * Normalizes a pattern string for drift-tolerant comparison.
 * Lowercase + underscore-to-hyphen. Defense-in-depth for legacy records.
 */
function canonicalizePattern(p: string): string {
  assert(typeof p === 'string', 'pattern must be a string');
  return p.toLowerCase().replace(/_/g, '-');
}

/**
 * Computes Jaccard similarity between two tag arrays.
 * Jaccard = |intersection| / |union|. Returns 0 if both arrays are empty.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  assert(Array.isArray(a) && Array.isArray(b), 'tag arrays must be arrays');
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  const setB = new Set(b.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const tag of setA) { // P10 Rule 2: bounded by setA.size (small tag list)
    if (setB.has(tag)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if the pattern value is in the closed enum.
 * Novel patterns — never seen in the enum — must not reach HIGH.
 */
function isKnownPattern(pattern: string): boolean {
  assert(typeof pattern === 'string', 'pattern must be a string');
  const canonical = canonicalizePattern(pattern);
  for (let i = 0; i < SIGNAL_PATTERNS.length; i++) { // P10 Rule 2: bounded by SIGNAL_PATTERNS.length
    if (canonicalizePattern(SIGNAL_PATTERNS[i] ?? '') === canonical) return true;
  }
  return false;
}

/**
 * Determines whether a set of matched SignalRecords constitutes a HIGH-confidence
 * or LOW-confidence verdict for automated plan application.
 *
 * HIGH requires ALL of:
 *   1. >= N_DISTINCT distinct records
 *   2. All records within valid_until (not expired)
 *   3. All record patterns are known (non-novel per closed enum)
 *   4. Records agree on pattern after canonicalization AND
 *      topic_tags Jaccard >= JACCARD_MATCH_THRESHOLD between any pair
 *
 * Any clause failure → LOW. Tie always goes to LOW.
 * Per council ruling 2026-06-23-toto-wolff-v1-confidence-scoring-contract.
 */
export function scoreConfidence(
  records: SignalRecord[],
  now: string,
): { tier: 'HIGH' | 'LOW'; matchCount: number; disqualifiers: string[] } {
  assert(typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now), 'now must be YYYY-MM-DD');

  const disqualifiers: string[] = [];

  if (records.length < N_DISTINCT) {
    disqualifiers.push(`fewer than ${N_DISTINCT} distinct records (got ${records.length})`);
    return { tier: 'LOW', matchCount: records.length, disqualifiers };
  }

  for (let i = 0; i < records.length; i++) { // P10 Rule 2: bounded by records.length
    const r = records[i];
    if (r == null) continue;

    if (r.valid_until < now) {
      disqualifiers.push(`record "${r.id}" expired on ${r.valid_until}`);
    }

    if (r.pattern == null || !isKnownPattern(r.pattern)) {
      disqualifiers.push(`record "${r.id}" has novel or missing pattern`);
    }
  }

  // Pairwise Jaccard check on topic_tags — any pair below threshold disqualifies
  for (let i = 0; i < records.length - 1; i++) { // P10 Rule 2: bounded by records.length
    for (let j = i + 1; j < records.length; j++) { // P10 Rule 2: inner bound
      const ra = records[i];
      const rb = records[j];
      if (ra == null || rb == null) continue;
      const tagsA = ra.topic_tags ?? [];
      const tagsB = rb.topic_tags ?? [];
      const sim = jaccardSimilarity(tagsA, tagsB);
      if (sim < JACCARD_MATCH_THRESHOLD) {
        disqualifiers.push(`records "${ra.id}" and "${rb.id}" topic_tags Jaccard=${sim.toFixed(2)} below threshold ${JACCARD_MATCH_THRESHOLD}`);
      }
    }
  }

  if (disqualifiers.length > 0) {
    return { tier: 'LOW', matchCount: records.length, disqualifiers };
  }

  return { tier: 'HIGH', matchCount: records.length, disqualifiers: [] };
}
