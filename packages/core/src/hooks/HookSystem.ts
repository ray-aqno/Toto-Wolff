/**
 * HookSystem — manages hook registration and execution chain.
 * Enforces max chain length (5) to prevent unbounded execution.
 */

import { HookExecutor, HookContext, HookResult, HookSystemConfig } from './HookTypes.js';
import { DRSService } from '../DRSService.js';
import { VaultService } from '../VaultService.js';

const DEFAULT_MAX_CHAIN_LENGTH = 5;

/**
 * Runs registered HookExecutors in priority order (lowest first) and stops at
 * the first one that blocks. The chain length is capped so a misconfigured
 * registration can't trigger unbounded work.
 */
export class HookSystem {
  private executors = new Map<string, HookExecutor>();
  private readonly maxChainLength: number;

  /** Creates a hook system; `config.maxChainLength` (default 5) caps how many executors one `execute()` will run. */
  constructor(config?: Partial<HookSystemConfig>) {
    this.maxChainLength = config?.maxChainLength ?? DEFAULT_MAX_CHAIN_LENGTH;
  }

  /** Register a hook executor. */
  register(executor: HookExecutor): void {
    if (this.executors.has(executor.id)) {
      throw new Error(`Hook executor already registered: ${executor.id}`);
    }
    this.executors.set(executor.id, executor);
  }

  /** Unregister a hook executor. */
  unregister(id: string): boolean {
    return this.executors.delete(id);
  }

  /** Get a registered executor by ID. */
  get(id: string): HookExecutor | undefined {
    return this.executors.get(id);
  }

  /** List all registered executors. */
  list(): readonly HookExecutor[] {
    return Array.from(this.executors.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Execute the hook chain for a given context. The first executor to block
   * wins outright. If every executor allows, the first one that accepted an
   * override is returned as-is, so callers can tell an override-allow from an
   * ordinary allow (`override` / `overrideReason` are part of the HookResult
   * contract); otherwise a plain `{ allowed: true }`.
   */
  async execute(context: HookContext): Promise<HookResult> {
    const executors = this.list();
    if (executors.length === 0) {
      return { allowed: true };
    }

    if (executors.length > this.maxChainLength) {
      throw new Error(`Hook chain length (${executors.length}) exceeds maximum (${this.maxChainLength})`);
    }

    let acceptedOverride: HookResult | undefined;
    for (const executor of executors) {
      const result = await executor.execute(context);
      if (!result.allowed) {
        return result;
      }
      if (result.override === true && acceptedOverride === undefined) {
        acceptedOverride = result;
      }
    }

    return acceptedOverride ?? { allowed: true };
  }

  /**
   * Load hooks from configuration. `vault` is threaded through to DRSService
   * for its override audit-trail write — reuse the same VaultService instance
   * the caller already constructed elsewhere, rather than building a second
   * one, so audit records stay consolidated in one vault-write path.
   */
  loadConfig(config: HookSystemConfig, vault?: VaultService): void {
    for (const hookConfig of config.hooks) {
      if (!hookConfig.enabled) continue;

      // Built-in DRS hook
      if (hookConfig.id === 'drs') {
        const drs = new DRSService(undefined, vault);
        this.register(drs);
        continue;
      }

      // Custom hooks would be registered here via factory pattern
      // For now, only DRS is built-in
    }
  }

  /** Get the maximum chain length. */
  getMaxChainLength(): number {
    return this.maxChainLength;
  }

  /** Clear all registered executors. */
  clear(): void {
    this.executors.clear();
  }
}

export const HookSystemInstance = new HookSystem();