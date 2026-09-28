/**
 * Backward-compatible Anthropic client creation.
 * Delegates to legacy implementation for exact same behavior.
 * `createAnthropicClient` (re-exported below) is the path actually in use
 * today, across KarpathyService, CabinetService, P10Service, SafetyCarService,
 * CouncilService, the CLI, and tests.
 */
export { createAnthropicClient } from './anthropicLegacy.js';
export { createAnthropicClient as createAnthropicClientLegacy } from './anthropicLegacy.js';
//# sourceMappingURL=anthropic.d.ts.map