import type { SignalRecord } from "@toto-wolff/core";
/**
 * In-memory index of active SignalRecords loaded from VAULT_PATH/Signals/.
 * Call load() before querying. Supports filtering by pattern_tag frontmatter
 * field and returning all active records. Fresh load per request in spike scope.
 */
export declare class SignalIndex {
    private readonly vaultPath;
    private records;
    private vaultPromise;
    /** Create an index rooted at `vaultPath`. Call `load()` before querying. */
    constructor(vaultPath: string);
    /**
     * Lazily construct (and memoize) the V2 vault facade for this instance.
     * On construction failure the memo is cleared so the next call retries.
     */
    private getVault;
    /**
     * Loads all valid, non-expired SignalRecords from VAULT_PATH/Signals/.
     * Capped at MAX_RECORDS. Replaces any previously loaded records.
     */
    load(): Promise<void>;
    /**
     * Returns all loaded SignalRecords whose topic_tags array contains patternTag
     * as an exact member. Returns all records if patternTag is empty.
     * Semantic: exact array membership, not substring match.
     */
    query(patternTag: string): SignalRecord[];
    /** Returns all loaded SignalRecords. */
    getAll(): SignalRecord[];
}
//# sourceMappingURL=signal_index.d.ts.map