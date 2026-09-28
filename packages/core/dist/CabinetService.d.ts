import type { VaultService } from './VaultService.js';
import type { CabinetResult } from './types.js';
export declare class CabinetService {
    private readonly client;
    private readonly vault;
    constructor(vault: VaultService);
    run(subject: string, version: string, evidenceBrief?: string): Promise<CabinetResult>;
    private assembleBrief;
    private conveneSeats;
    private callSeat;
    private synthesize;
    private callSynthesis;
    private writeRecord;
    private formatRecord;
}
//# sourceMappingURL=CabinetService.d.ts.map