import type { VaultService } from './VaultService.js';
import type { CouncilRuling, CouncilStatus, SignalRecord } from './types.js';
import type { BudgetFlag } from './utils/TokenBudget.js';
export interface CouncilResult {
    status: CouncilStatus;
    ruling: string;
    brief: string;
    recordPath: string;
    /**
     * Invariant: `priorId` is only ever set when `reversalDetected === true`.
     * Callers must check `reversalDetected` first — do not branch on the
     * truthiness of `priorId` alone, since its absence does not by itself
     * mean no reversal was detected (both fields are optional).
     */
    reversalDetected?: boolean;
    priorId?: string;
    /** Set only when checkSessionBudget() detects a structural fan-out violation. */
    budgetFlag?: BudgetFlag;
}
export declare class CouncilService {
    private readonly client;
    private readonly vault;
    constructor(vault: VaultService);
    /**
     * Run a council session on a governance question.
     * T10 fast-path: factual questions (no tradeoff language) with a direct vault_search hit
     * skip straight to a single Sonnet summary call instead of the full 6-call chain.
     * Full chain flow: parallel scouts → compression → parallel analysts → brief → chairman ruling → vault write.
     */
    run(question: string, currentTags?: string[], priors?: SignalRecord[]): Promise<CouncilResult>;
    /**
     * Scouts → compression → analysts → brief writer. Isolated from
     * _runFullChain purely to stay under the repo's max-lines-per-function
     * lint cap — no behavior change, same sequential chain.
     */
    private _deliberate;
    /** Chairman ruling → vault write → reversal check. Second half of the full chain. */
    private _runFullChain;
    /**
     * Checks the session's aggregate usage against the verified call-graph
     * ceiling and applies the tiered enforcement action. seat_overrun warns
     * and lets the result through unchanged — legitimate deep deliberation.
     * fanout_overrun logs an error and flags the result for the vault record.
     */
    private _applyBudgetVerdict;
    /**
     * T10 heuristic: a question is "factual" (fast-path eligible) when it contains
     * no tradeoff/deliberation language. Deliberative questions always take the full chain.
     */
    private _isFactualQuestion;
    /**
     * T10 fast-path: vault_search + single Sonnet call for direct factual lookups.
     * Returns null (caller falls back to full chain) if vault_search finds nothing.
     */
    private _tryFastPath;
    /**
     * Compress verbose scout output to 5 terse bullet points.
     * Reduces context rot in downstream analyst calls (Hong et al.).
     */
    private _compress;
    private _callModel;
}
/**
 * Parses the Chairman's ruling text into a structured CouncilRuling.
 * Regex-matches a `status:` line against the three known values
 * (case-insensitive); defaults to `'blocked'` if no match is found (fail
 * closed, not fail open). `summary` is the raw ruling text, truncated to
 * 500 chars.
 */
export declare function parseRuling(raw: string): CouncilRuling;
//# sourceMappingURL=CouncilService.d.ts.map