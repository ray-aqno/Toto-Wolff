/**
 * Hook system types: defines the interface for hook execution and context.
 */

export interface HookContext {
  tool: string;
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
  timestamp: number;
  tenant?: string;
}

export interface HookResult {
  allowed: boolean;
  ruleFired?: number;
  reason?: string;
  override?: boolean;
  overrideReason?: string;
}

/**
 * A pluggable check that HookSystem runs before a governed tool call proceeds,
 * so enforcement (the built-in DRS hook is one) plugs in without HookSystem
 * knowing any rule logic. Executors run in ascending `priority` order.
 */
export interface HookExecutor {
  readonly id: string;
  readonly name: string;
  readonly priority: number; // Lower = runs first

  /**
   * Decides whether the tool call described by `context` may proceed. Return
   * `allowed: false` to stop the chain; HookSystem returns that result as-is.
   * Return `allowed: true` with `override: true` (and `overrideReason`) for a
   * call a rule would otherwise have blocked, and HookSystem surfaces it so
   * callers can tell an override-allow from an ordinary allow.
   */
  execute(context: HookContext): HookResult | Promise<HookResult>;
}

export interface HookConfig {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface HookSystemConfig {
  hooks: HookConfig[];
  maxChainLength: number;
}