import type { IncomingMessage, ServerResponse } from 'node:http';
/**
 * GET /vault/signal — returns active signal records as a JSON array via SignalIndex.
 * 200+[] on empty (cold-start is a first-class state, not an error).
 * 500 only on index load failure.
 */
export declare function handleVaultSignal(_req: IncomingMessage, res: ServerResponse, vaultPath: string): Promise<void>;
//# sourceMappingURL=vault_signal.d.ts.map