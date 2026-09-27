import type { VaultService } from './VaultService.js';
import type { P10Result, P10Ruling } from './types.js';
export declare class P10Service {
    private readonly client;
    private readonly vault;
    constructor(vault: VaultService);
    /**
     * Run a full P10 pre-execution planning cycle for the given task.
     * Scouts run in parallel, outputs are compressed, then passed through
     * analyzer → draft writer → arbiter. One revision cycle is permitted.
     * Throws P10BlockedError if the arbiter blocks or the revision cap is hit.
     */
    runPlan(task: string): Promise<P10Result>;
    /**
     * Run the two scouts in parallel. Each scout receives only the task description
     * as its user message (no prior context) — per lost-in-the-middle positioning.
     */
    private runScouts;
    /**
     * Compress each scout output to 5 terse bullet points before passing to the
     * analyzer. Prevents context rot and format tax from verbose scout prose.
     */
    private compressScouts;
    /**
     * Run the analyzer with compressed scout summaries at the top and the task at
     * the bottom — critical context first to avoid lost-in-the-middle degradation.
     */
    private runAnalyzer;
    /**
     * Run the draft writer with analyzer output at the top and the task at the
     * bottom — preserves primacy of analysis context.
     */
    private runDraftWriter;
    /**
     * Run the Opus arbiter with the draft plan at the top and the task at the
     * bottom — arbiter sees the artifact first, task last for grounding.
     */
    private runArbiter;
    private commitPlan;
    /**
     * Call a model with temperature: 0 for deterministic planning output.
     * system prompt is optional; when provided it is passed as the system field.
     */
    private callModel;
}
/**
 * Parses the Arbiter's ruling text into a structured P10Ruling.
 * Extracts two fields: `status` (regex-matched against the three known
 * values, case-insensitive, defaults to `'blocked'` on no match: fail
 * closed, not fail open) and an optional `requiredChanges` (only present
 * when a `required-changes:` line is found). `summary` is the raw ruling
 * text, truncated to 500 chars.
 */
export declare function parseP10Ruling(raw: string): P10Ruling;
//# sourceMappingURL=P10Service.d.ts.map