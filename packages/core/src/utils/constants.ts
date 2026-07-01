/**
 * Reversal detection constants.
 * Changes require a council record — same discipline as scoreConfidence constants.
 */

/** Minimum Jaccard similarity for two sessions to be considered topic-matched. */
export const REVERSAL_JACCARD_THRESHOLD = 0.5;

/** Maximum priors to scan. Kept in sync by convention with mcp-server's SignalIndex load cap (500), not by shared import — the two packages don't cross-reference constants. */
export const SIGNAL_MAX_PRIORS = 500;

/** Separator used when building a tag fingerprint key. */
export const TAG_SEPARATOR = '|';
