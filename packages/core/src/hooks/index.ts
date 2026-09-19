/**
 * Hooks module — pluggable hook system for governance enforcement.
 * Exports: HookExecutor, HookContext, HookResult, HookConfig, HookSystemConfig, HookSystem
 */

export type { HookExecutor, HookContext, HookResult, HookConfig, HookSystemConfig } from './HookTypes.js';
export { HookSystem, HookSystemInstance } from './HookSystem.js';