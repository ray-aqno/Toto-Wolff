export class VaultCommitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultCommitError';
    }
}
export class VaultSearchError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VaultSearchError';
    }
}
export class LLMTimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LLMTimeoutError';
    }
}
export class P10BlockedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'P10BlockedError';
    }
}
/**
 * Closed enum of valid pattern values for SignalRecord.
 * Adding a new pattern requires a code change — this is intentional (write-path enforcement).
 * Per council ruling 2026-06-23-toto-wolff-v1-confidence-scoring-contract.
 */
export const SIGNAL_PATTERNS = [
    'shared-session-state-auth-extraction',
    'architectural-decision-record',
    'p10-approved-plan',
];
/** isSignalRecord is the only legal path from unknown to SignalRecord. */
export function isSignalRecord(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const r = v;
    if (typeof r['id'] !== 'string' || r['id'].length === 0 ||
        typeof r['content_hash'] !== 'string' || r['content_hash'].length === 0 ||
        typeof r['valid_until'] !== 'string' || r['valid_until'].length === 0 ||
        typeof r['verdict'] !== 'string' || r['verdict'].length === 0)
        return false;
    // Optional fields: if present, must be correct type
    if (r['pattern'] !== undefined && typeof r['pattern'] !== 'string')
        return false;
    if (r['topic_tags'] !== undefined) {
        if (!Array.isArray(r['topic_tags']))
            return false;
        for (let i = 0; i < r['topic_tags'].length; i++) { // P10 Rule 2: bounded by array length
            if (typeof r['topic_tags'][i] !== 'string')
                return false;
        }
    }
    return true;
}
//# sourceMappingURL=types.js.map