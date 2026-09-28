/**
 * HookSystem: manages hook registration and execution chain.
 * Enforces max chain length (5) to prevent unbounded execution.
 */
import { HookExecutor, HookContext, HookResult, HookSystemConfig } from './HookTypes.js';
import { VaultService } from '../VaultService.js';
/**
 * Runs registered HookExecutors in priority order (lowest first) and stops at
 * the first one that blocks. The chain length is capped so a misconfigured
 * registration can't trigger unbounded work.
 */
export declare class HookSystem {
    private executors;
    private readonly maxChainLength;
    /** Creates a hook system; `config.maxChainLength` (default 5) caps how many executors one `execute()` will run. */
    constructor(config?: Partial<HookSystemConfig>);
    /** Register a hook executor. */
    register(executor: HookExecutor): void;
    /** Unregister a hook executor. */
    unregister(id: string): boolean;
    /** Get a registered executor by ID. */
    get(id: string): HookExecutor | undefined;
    /** List all registered executors. */
    list(): readonly HookExecutor[];
    /**
     * Execute the hook chain for a given context. The first executor to block
     * wins outright. If every executor allows, the first one that accepted an
     * override is returned as-is, so callers can tell an override-allow from an
     * ordinary allow (`override` / `overrideReason` are part of the HookResult
     * contract); otherwise a plain `{ allowed: true }`.
     */
    execute(context: HookContext): Promise<HookResult>;
    /**
     * Load hooks from configuration. `vault` is threaded through to DRSService
     * for its override audit-trail write. Reuse the same VaultService instance
     * the caller already constructed elsewhere, rather than building a second
     * one, so audit records stay consolidated in one vault-write path.
     */
    loadConfig(config: HookSystemConfig, vault?: VaultService): void;
    /** Get the maximum chain length. */
    getMaxChainLength(): number;
    /** Clear all registered executors. */
    clear(): void;
}
export declare const HookSystemInstance: HookSystem;
//# sourceMappingURL=HookSystem.d.ts.map