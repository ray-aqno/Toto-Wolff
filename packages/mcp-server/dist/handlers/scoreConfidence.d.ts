import type { SignalRecord } from '@toto-wolff/core';
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
export declare function scoreConfidence(records: SignalRecord[], now: string): {
    tier: 'HIGH' | 'LOW';
    matchCount: number;
    disqualifiers: string[];
};
//# sourceMappingURL=scoreConfidence.d.ts.map