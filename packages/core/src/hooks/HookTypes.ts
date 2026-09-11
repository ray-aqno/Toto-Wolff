/**
 * Hook system types — defines the interface for hook execution and context.
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

export interface HookExecutor {
  readonly id: string;
  readonly name: string;
  readonly priority: number; // Lower = runs first

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