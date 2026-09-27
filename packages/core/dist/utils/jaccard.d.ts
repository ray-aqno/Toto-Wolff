/**
 * Computes Jaccard similarity between two tag arrays.
 * Jaccard = |intersection| / |union|. Returns 0 if both arrays are empty.
 * P10 Rule 2: inner loop bounded by setA.size (tag cardinality 2–5 per corpus).
 */
export declare function jaccardSimilarity(a: string[], b: string[]): number;
/** Minimum Jaccard similarity for topic_tags match. Set from corpus; tag cardinality 2–5. */
export declare const JACCARD_MATCH_THRESHOLD = 0.5;
//# sourceMappingURL=jaccard.d.ts.map