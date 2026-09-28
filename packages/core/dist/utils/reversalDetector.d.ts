import type { SignalRecord } from '../types.js';
export interface ReversalResult {
    /** ID of the prior SignalRecord whose verdict conflicts with currentVerdict. */
    priorId: string;
    /** Jaccard similarity score that triggered the match. */
    similarity: number;
    /** Prior verdict that conflicts. */
    priorVerdict: string;
}
/**
 * Detects whether currentVerdict conflicts with a prior ruling on the same topic.
 *
 * Pure synchronous scan of priors. No I/O. Caller (mcp-server handler) owns
 * loading priors via SignalIndex and must catch VaultSearchError before calling here.
 * Caller also owns currentTags — pass the topic_tags from the SignalRecord
 * the handler constructs for the current session. Do not derive tags from summary text.
 *
 * P10 Rule 2: priors bounded by SIGNAL_MAX_PRIORS (this module's own constant,
 * independent of whatever cap the mcp-server's SignalIndex.load() applies).
 * P10 Rule 7: no async, no I/O. Async boundary is entirely in the caller.
 */
export declare function detectReversal(currentVerdict: string, currentTags: string[], priors: SignalRecord[]): ReversalResult | null;
//# sourceMappingURL=reversalDetector.d.ts.map