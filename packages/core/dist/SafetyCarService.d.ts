import type { VaultService } from './VaultService.js';
import type { SafetyCarReport, SafetyCarRisk } from './types.js';
export declare class SafetyCarService {
    private readonly client;
    private readonly vault;
    constructor(vault: VaultService);
    run(planPath: string): Promise<SafetyCarReport>;
    private loadPlan;
    private adversarialReview;
    private callModel;
    /** Thin delegator to the standalone parseSafetyCarRisks(), so run() needs no change. */
    private parseRisks;
    private validateRisks;
    private emitReport;
    private buildSummary;
}
/**
 * Parses the reviewer model's raw JSON response into SafetyCarRisk[].
 * Preserves the existing strategy verbatim: JSON.parse, then map each
 * entry's fields (coercing to the expected shape), falling back to
 * `planPath` for a missing `planRef`. Returns `[]` on any parse failure
 * or when `risks` isn't an array. That is not a bug to fix, matching this
 * service's existing fail-to-empty behavior.
 */
export declare function parseSafetyCarRisks(raw: string, planPath: string): SafetyCarRisk[];
//# sourceMappingURL=SafetyCarService.d.ts.map