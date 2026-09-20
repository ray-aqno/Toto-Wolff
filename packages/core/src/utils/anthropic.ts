/**
 * Backward-compatible Anthropic client creation.
 * Delegates to legacy implementation for exact same behavior.
 * `createAnthropicClient` (re-exported below) is the path actually in use
 * today, across KarpathyService, CabinetService, P10Service, SafetyCarService,
 * CouncilService, the CLI, and tests.
 */

// Re-export the legacy client for backward compatibility
export { createAnthropicClient } from './anthropicLegacy.js';
export { createAnthropicClient as createAnthropicClientLegacy } from './anthropicLegacy.js';