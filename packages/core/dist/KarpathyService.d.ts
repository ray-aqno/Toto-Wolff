import type { VaultService } from './VaultService.js';
import type { KarpathyCheck } from './types.js';
export declare class KarpathyService {
    private readonly client;
    private readonly vault;
    constructor(vault: VaultService);
    check(planPath: string, stage: string, diff?: string): Promise<KarpathyCheck>;
    private verifyStage;
    private buildPrompt;
    private callModel;
    private loadPlan;
    private parseViolations;
    private isValidViolation;
    private reportViolations;
    private buildSummary;
}
//# sourceMappingURL=KarpathyService.d.ts.map